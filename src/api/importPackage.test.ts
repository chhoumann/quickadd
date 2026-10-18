import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";
import type IChoice from "../types/choices/IChoice";
import type { QuickAddPackage } from "../types/packages/QuickAddPackage";
import { encodeToBase64 } from "../utils/base64";
import { importPackage } from "./choiceApi";

function fakePlugin(files: Map<string, string>) {
	const app = {
		vault: {
			configDir: ".obsidian",
			adapter: {
				exists: vi.fn(async (path: string) => files.has(path)),
				write: vi.fn(async (path: string, content: string) => {
					files.set(path, content);
				}),
			},
			createFolder: vi.fn(async () => {}),
		},
	} as unknown as App;
	const plugin = {
		app,
		addCommandForChoice: vi.fn(),
		removeCommandForChoice: vi.fn(),
		saveSettings: vi.fn(async () => {}),
	};
	return plugin as unknown as QuickAdd & typeof plugin;
}

function capture(id: string, name: string): IChoice {
	return { id, name, type: "Capture", command: true, captureTo: "{{VALUE:episodeNote}}" } as IChoice;
}

function pkg(choices: IChoice[], assets: QuickAddPackage["assets"] = []): string {
	return JSON.stringify({
		schemaVersion: 1,
		quickAddVersion: "2.33.0",
		createdAt: "2026-10-18T00:00:00.000Z",
		rootChoiceIds: choices.map((choice) => choice.id),
		choices: choices.map((choice) => ({ choice, pathHint: [choice.name], parentChoiceId: null })),
		assets,
	} satisfies QuickAddPackage);
}

const template = (originalPath: string, content: string): QuickAddPackage["assets"][number] => ({
	kind: "capture-template",
	originalPath,
	contentEncoding: "base64",
	content: encodeToBase64(content),
});

describe("importPackage", () => {
	let files: Map<string, string>;

	beforeEach(() => {
		files = new Map();
		settingsStore.setState({ choices: [], templateFolderPaths: [] });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("adds the package's choices, registers their commands and saves", async () => {
		const plugin = fakePlugin(files);

		const summary = await importPackage(plugin, pkg([capture("podnotes-capture", "Podcast capture")]));

		expect(summary).toEqual({
			addedChoiceIds: ["podnotes-capture"],
			skippedChoiceIds: [],
			writtenAssets: [],
			skippedAssets: [],
		});
		expect(settingsStore.getState().choices.map((choice) => choice.name)).toEqual(["Podcast capture"]);
		expect(plugin.addCommandForChoice).toHaveBeenCalledTimes(1);
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("resolves only after the settings are saved", async () => {
		let finishSave = () => {};
		const plugin = fakePlugin(files);
		plugin.saveSettings.mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve; }));
		let resolved = false;

		const run = importPackage(plugin, pkg([capture("podnotes-capture", "Podcast capture")])).then(() => {
			resolved = true;
		});
		await vi.waitFor(() => expect(plugin.saveSettings).toHaveBeenCalled());
		await Promise.resolve();
		expect(resolved).toBe(false);

		finishSave();
		await run;
		expect(resolved).toBe(true);
	});

	it("skips a choice whose id is already in the vault and keeps it as it is", async () => {
		const mine = { ...capture("podnotes-capture", "My capture"), captureTo: "Inbox.md" } as IChoice;
		settingsStore.setState({ choices: [mine] });
		const plugin = fakePlugin(files);

		const summary = await importPackage(
			plugin,
			pkg([capture("podnotes-capture", "Podcast capture"), capture("other", "Other")]),
		);

		expect(summary.addedChoiceIds).toEqual(["other"]);
		expect(summary.skippedChoiceIds).toEqual(["podnotes-capture"]);
		expect(settingsStore.getState().choices).toEqual([mine, expect.objectContaining({ id: "other" })]);
		expect(plugin.removeCommandForChoice).not.toHaveBeenCalled();
	});

	it("keeps a file that already exists", async () => {
		files.set("Templates/Note.md", "mine");
		const plugin = fakePlugin(files);

		const summary = await importPackage(
			plugin,
			pkg([capture("new", "New")], [template("Templates/Note.md", "theirs"), template("Templates/Fresh.md", "fresh")]),
		);

		expect(summary.skippedAssets).toEqual(["Templates/Note.md"]);
		expect(summary.writtenAssets).toEqual(["Templates/Fresh.md"]);
		expect(files.get("Templates/Note.md")).toBe("mine");
	});

	it("keeps an existing file that the package spells with padding", async () => {
		files.set("Templates/Note.md", "mine");
		const plugin = fakePlugin(files);

		const summary = await importPackage(plugin, pkg([capture("new", "New")], [template(" Templates/Note.md ", "theirs")]));

		expect(summary.skippedAssets).toEqual(["Templates/Note.md"]);
		expect(files.get("Templates/Note.md")).toBe("mine");
	});

	it("writes no file when a later file in the package cannot be decoded", async () => {
		// Obsidian decodes with the browser's atob, which throws on bad input.
		vi.stubGlobal("window", { atob });
		const plugin = fakePlugin(files);
		const broken = { ...template("Templates/Broken.md", ""), content: "%%%" };

		await expect(
			importPackage(plugin, pkg([capture("new", "New")], [template("Templates/Fresh.md", "fresh"), broken])),
		).rejects.toThrow();

		expect(plugin.app.vault.adapter.write).not.toHaveBeenCalled();
		expect(plugin.app.vault.createFolder).not.toHaveBeenCalled();
		expect(settingsStore.getState().choices).toEqual([]);
	});

	it.each([
		["not JSON", "{"],
		["not a package", JSON.stringify({ choices: [] })],
	])("throws for a package that is %s and changes nothing", async (_label, packageJson) => {
		const mine = capture("mine", "Mine");
		settingsStore.setState({ choices: [mine] });
		const plugin = fakePlugin(files);

		await expect(importPackage(plugin, packageJson)).rejects.toThrow();

		expect(settingsStore.getState().choices).toEqual([mine]);
		expect(plugin.app.vault.adapter.write).not.toHaveBeenCalled();
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});

	it("refuses a package that needs review and changes nothing", async () => {
		const macro = {
			id: "macro",
			name: "Sync",
			type: "Macro",
			command: false,
			runOnStartup: false,
			macro: {
				id: "m",
				name: "Sync",
				commands: [{ id: "s", name: "sync", type: "UserScript", path: "scripts/sync.js", settings: {} }],
			},
		} as unknown as IChoice;
		const plugin = fakePlugin(files);

		await expect(
			importPackage(plugin, pkg([macro], [{ ...template("scripts/sync.js", "module.exports = () => {};"), kind: "user-script" }])),
		).rejects.toThrow("This package needs review");

		expect(settingsStore.getState().choices).toEqual([]);
		expect(files.has("scripts/sync.js")).toBe(false);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});
});
