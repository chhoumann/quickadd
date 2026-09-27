import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, CliData } from "obsidian";
import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";
import type IChoice from "../types/choices/IChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { QuickAddPackage } from "../types/packages/QuickAddPackage";
import { encodeToBase64 } from "../utils/base64";
import { importPackageHandler } from "./importPackageCli";

const PACKAGE_PATH = "packages/example.quickadd.json";

function fakeVault(initialFiles: Record<string, string>) {
	const files = new Map(Object.entries(initialFiles));
	const app = {
		vault: {
			configDir: ".obsidian",
			adapter: {
				exists: vi.fn(async (path: string) => files.has(path)),
				read: vi.fn(async (path: string) => {
					const content = files.get(path);
					if (content === undefined) throw new Error(`Missing file: ${path}`);
					return content;
				}),
				write: vi.fn(async (path: string, content: string) => {
					files.set(path, content);
				}),
			},
			createFolder: vi.fn(async () => {}),
		},
	} as unknown as App;
	return { app, files };
}

function fakePlugin(app: App) {
	const plugin = {
		app,
		addCommandForChoice: vi.fn(),
		removeCommandForChoice: vi.fn(),
		saveSettings: vi.fn(async () => {}),
	};
	return plugin as unknown as QuickAdd & typeof plugin;
}

function templateChoice(overrides: Partial<ITemplateChoice> = {}): ITemplateChoice {
	return {
		id: "tpl-1",
		name: "Meeting note",
		type: "Template",
		command: true,
		templatePath: "Templates/Meeting.md",
		...overrides,
	} as ITemplateChoice;
}

function pkg(choices: IChoice[], assets: QuickAddPackage["assets"] = []): string {
	const value: QuickAddPackage = {
		schemaVersion: 1,
		quickAddVersion: "2.30.0",
		createdAt: "2026-01-01T00:00:00.000Z",
		rootChoiceIds: choices.map((choice) => choice.id),
		choices: choices.map((choice) => ({
			choice,
			pathHint: [choice.name],
			parentChoiceId: null,
		})),
		assets,
	};
	return JSON.stringify(value);
}

const run = (plugin: QuickAdd, params: Record<string, string>) =>
	importPackageHandler(plugin, params as unknown as CliData);

describe("quickadd:package-import", () => {
	beforeEach(() => {
		settingsStore.setState({ choices: [], templateFolderPaths: ["Templates"] });
	});

	it("imports choices, writes templates into the template folder and registers commands", async () => {
		const choice = templateChoice();
		const { app, files } = fakeVault({
			[PACKAGE_PATH]: pkg(
				[choice],
				[
					{
						kind: "template",
						originalPath: "Exporter/Meeting.md",
						contentEncoding: "base64",
						content: encodeToBase64("# {{VALUE:Title}}\n"),
					},
				],
			),
		});
		const plugin = fakePlugin(app);

		const result = await run(plugin, { path: PACKAGE_PATH });

		expect(result).toEqual({
			ok: true,
			added: ["tpl-1"],
			overwritten: [],
			skipped: [],
			writtenAssets: ["Templates/Meeting.md"],
			skippedAssets: [],
			choices: [{ id: "tpl-1", name: "Meeting note", type: "Template" }],
		});
		expect(files.get("Templates/Meeting.md")).toBe("# {{VALUE:Title}}\n");

		const imported = settingsStore.getState().choices[0] as ITemplateChoice;
		expect(imported.templatePath).toBe("Templates/Meeting.md");
		expect(plugin.addCommandForChoice).toHaveBeenCalledTimes(1);
		expect((plugin.addCommandForChoice.mock.calls[0][0] as IChoice).id).toBe("tpl-1");
		// Saved immediately: the CLI caller reads settings right after the call returns.
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});

	it("refuses a package that runs code until acknowledge=true, and lists what to review", async () => {
		const macro: IChoice = {
			id: "macro-1",
			name: "Sync",
			type: "Macro",
			command: false,
			runOnStartup: false,
			macro: {
				id: "m",
				name: "Sync",
				commands: [
					{
						id: "s",
						name: "sync",
						type: "UserScript",
						path: "scripts/sync.js",
						settings: {},
					},
				],
			},
		} as unknown as IChoice;
		const { app, files } = fakeVault({
			[PACKAGE_PATH]: pkg(
				[macro],
				[
					{
						kind: "user-script",
						originalPath: "scripts/sync.js",
						contentEncoding: "base64",
						content: encodeToBase64("module.exports = async () => {};"),
					},
				],
			),
		});
		const plugin = fakePlugin(app);

		const refused = await run(plugin, { path: PACKAGE_PATH });

		expect(refused.ok).toBe(false);
		expect(refused.criticalScriptPaths).toEqual(["scripts/sync.js"]);
		expect(files.has("scripts/sync.js")).toBe(false);
		expect(settingsStore.getState().choices).toEqual([]);
		expect(plugin.saveSettings).not.toHaveBeenCalled();

		const accepted = await run(plugin, { path: PACKAGE_PATH, acknowledge: "true" });

		expect(accepted.ok).toBe(true);
		expect(accepted.writtenAssets).toEqual(["scripts/sync.js"]);
		expect(files.get("scripts/sync.js")).toBe("module.exports = async () => {};");
		// The registrar (main.ts) decides from `choice.command` whether a palette
		// entry is created; the sync hands it every added choice.
		expect(plugin.addCommandForChoice).toHaveBeenCalledTimes(1);
		expect((plugin.addCommandForChoice.mock.calls[0][0] as IChoice).command).toBe(false);
	});

	it("overwrites an existing choice by default and drops its old command first", async () => {
		const existing = templateChoice({ name: "Old name", templatePath: "Old.md" });
		settingsStore.setState({ choices: [existing] });
		const incoming = templateChoice({ name: "New name" });
		const { app } = fakeVault({ [PACKAGE_PATH]: pkg([incoming]) });
		const plugin = fakePlugin(app);

		const result = await run(plugin, { path: PACKAGE_PATH });

		expect(result.overwritten).toEqual(["tpl-1"]);
		expect(result.added).toEqual([]);
		expect(settingsStore.getState().choices.map((c) => c.name)).toEqual(["New name"]);
		expect(plugin.removeCommandForChoice.mock.calls[0][0]).toBe(existing);
		expect((plugin.addCommandForChoice.mock.calls[0][0] as IChoice).name).toBe("New name");
	});

	it("honours choices=duplicate by keeping the existing choice and adding a copy with a fresh id", async () => {
		settingsStore.setState({ choices: [templateChoice()] });
		const { app } = fakeVault({ [PACKAGE_PATH]: pkg([templateChoice()]) });
		const plugin = fakePlugin(app);

		const result = await run(plugin, { path: PACKAGE_PATH, choices: "duplicate" });

		expect(result.ok).toBe(true);
		const names = settingsStore.getState().choices.map((c) => c.name);
		expect(names).toHaveLength(2);
		const ids = settingsStore.getState().choices.map((c) => c.id);
		expect(new Set(ids).size).toBe(2);
		const added = result.added as string[];
		expect(added).toHaveLength(1);
		expect(added[0]).not.toBe("tpl-1");
		// The reported choice carries the fresh id, not the package's.
		expect((result.choices as Array<{ id: string }>)[0].id).toBe(added[0]);
	});

	it("skips bundled files with files=skip and leaves the vault untouched", async () => {
		settingsStore.setState({ templateFolderPaths: [] });
		const { app, files } = fakeVault({
			[PACKAGE_PATH]: pkg(
				[templateChoice()],
				[
					{
						kind: "template",
						originalPath: "Templates/Meeting.md",
						contentEncoding: "base64",
						content: encodeToBase64("new"),
					},
				],
			),
			"Templates/Meeting.md": "mine",
		});
		const plugin = fakePlugin(app);

		const result = await run(plugin, { path: PACKAGE_PATH, files: "skip" });

		expect(result.skippedAssets).toEqual(["Templates/Meeting.md"]);
		expect(result.writtenAssets).toEqual([]);
		expect(files.get("Templates/Meeting.md")).toBe("mine");
	});

	it("never stats a redirected destination that would leave the vault", async () => {
		// A template asset is redirected into the template folder by file name,
		// so a crafted name can only escape via a traversal segment.
		const { app } = fakeVault({
			[PACKAGE_PATH]: pkg(
				[templateChoice({ templatePath: ".." })],
				[
					{
						kind: "template",
						originalPath: "..",
						contentEncoding: "base64",
						content: encodeToBase64("x"),
					},
				],
			),
		});
		const plugin = fakePlugin(app);

		await expect(
			run(plugin, { path: PACKAGE_PATH, acknowledge: "true" }),
		).rejects.toThrow();

		const probed = (app.vault.adapter.exists as ReturnType<typeof vi.fn>).mock.calls.map(
			([path]) => path as string,
		);
		expect(probed).not.toContain("Templates/..");
		expect(settingsStore.getState().choices).toEqual([]);
	});

	it("rejects unknown modes and a missing path without touching settings", async () => {
		const { app } = fakeVault({ [PACKAGE_PATH]: pkg([templateChoice()]) });
		const plugin = fakePlugin(app);

		await expect(run(plugin, { path: PACKAGE_PATH, choices: "merge" })).rejects.toThrow(
			/Invalid choices=merge/,
		);
		await expect(run(plugin, { path: PACKAGE_PATH, files: "replace" })).rejects.toThrow(
			/Invalid files=replace/,
		);
		expect(await run(plugin, {})).toMatchObject({ ok: false });
		expect(settingsStore.getState().choices).toEqual([]);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});
});
