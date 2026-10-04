import { describe, expect, it, vi } from "vitest";
import { log } from "./logger/logManager";
import QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import { migrateSettingsV2 } from "./v3/migrate";

const choice = {
	id: "c1",
	name: "Inbox",
	type: "Capture",
	command: true,
	captureTo: "Inbox.md",
	format: { enabled: true, format: "- {{VALUE}}" },
} as unknown as IChoice;

function pluginOn(initial: object) {
	let disk: unknown = JSON.parse(JSON.stringify(initial));
	const plugin = new (QuickAdd as unknown as new () => QuickAdd)();
	const files: Record<string, ArrayBuffer> = {};
	Object.assign(plugin, {
		loadData: vi.fn(async () => JSON.parse(JSON.stringify(disk))),
		saveData: vi.fn(async (data: unknown) => {
			disk = JSON.parse(JSON.stringify(data));
		}),
		manifest: { id: "quickadd", dir: "plugin", version: "3.0.0" },
		app: {
			vault: {
				adapter: {
					readBinary: vi.fn(async (path: string) => files[path]),
					writeBinary: vi.fn(async (path: string, bytes: ArrayBuffer) => {
						files[path] = bytes;
					}),
				},
			},
		},
	});
	return {
		plugin,
		disk: () => disk as Record<string, unknown> & { actions: unknown[] },
		setDisk: (data: unknown) => {
			disk = JSON.parse(JSON.stringify(data));
		},
		files,
	};
}

describe("QuickAdd on stored actions", () => {
	const v3File = JSON.parse(JSON.stringify(migrateSettingsV2({ choices: [choice], migrations: { migrateToV3Actions: true } })));

	it("loads actions as choices and saves choices as actions", async () => {
		const { plugin, disk } = pluginOn(v3File);
		await plugin.loadSettings();
		expect(plugin.settings.choices.map((c) => c.name)).toEqual(["Inbox"]);
		expect(plugin.settings.actions).toEqual(v3File.actions);

		plugin.settings.choices[0].name = "Inbox (renamed)";
		await plugin.saveSettings();
		expect(disk()).not.toHaveProperty("choices");
		expect(disk().actions).toMatchObject([{ kind: "action", id: "c1", name: "Inbox (renamed)" }]);
	});

	it("keeps what only an action holds through a builder edit, a save and a synced change", async () => {
		const second = { ...choice, id: "c2", name: "Journal" } as IChoice;
		const file = JSON.parse(JSON.stringify(migrateSettingsV2({ choices: [choice, second], migrations: { migrateToV3Actions: true } })));
		file.actions[0].show.ribbon = true;
		file.actions[0].laterField = "kept";
		const { plugin, disk, setDisk } = pluginOn(file);
		await plugin.loadSettings();

		// An edit the builder makes: the choice is replaced by an edited copy.
		plugin.settings = {
			...plugin.settings,
			choices: plugin.settings.choices.map((c) => (c.id === "c1" ? { ...c, name: "Inbox (renamed)" } : c)),
		};
		await plugin.saveSettings();
		expect(disk().actions).toMatchObject([
			{ id: "c1", name: "Inbox (renamed)", show: { ribbon: true }, laterField: "kept" },
			{ id: "c2", name: "Journal" },
		]);

		// Another device shows the second action in the ribbon too.
		const synced = structuredClone(disk()) as typeof file;
		synced.actions[1].show.ribbon = true;
		synced.actions[1].laterField = "from elsewhere";
		setDisk(synced);
		await plugin.onExternalSettingsChange();
		expect(plugin.settings.actions).toEqual(synced.actions);
		expect(plugin.settings.choices.map((c) => c.name)).toEqual(["Inbox (renamed)", "Journal"]);

		await plugin.saveSettings();
		expect(disk().actions).toEqual(synced.actions);
	});

	it("merges a save onto actions that changed on disk since it loaded", async () => {
		const second = { ...choice, id: "c2", name: "Journal" } as IChoice;
		const file = JSON.parse(JSON.stringify(migrateSettingsV2({ choices: [choice, second], migrations: { migrateToV3Actions: true } })));
		const { plugin, disk, setDisk } = pluginOn(file);
		await plugin.loadSettings();
		const synced = structuredClone(file);
		synced.actions[1].show.ribbon = true;
		setDisk(synced);

		plugin.settings.choices[0].name = "Inbox (renamed)";
		await plugin.saveSettings();
		expect(disk().actions).toMatchObject([
			{ id: "c1", name: "Inbox (renamed)" },
			{ id: "c2", show: { ribbon: true } },
		]);
		expect(plugin.settings.actions?.[1]).toMatchObject({ show: { ribbon: true } });
	});

	it("does not see its own save as a change on disk", async () => {
		const { plugin } = pluginOn(v3File);
		await plugin.loadSettings();
		// Open settings behind a switched-off open toggle: saving drops them.
		Object.assign(plugin.settings.choices[0], {
			openFile: false,
			fileOpening: { location: "split", direction: "horizontal", mode: "source", focus: false },
		});
		const logMessage = vi.spyOn(log, "logMessage");
		await plugin.saveSettings();
		await plugin.saveSettings();
		expect(logMessage.mock.calls.flat().filter((message) => String(message).includes("changed on disk"))).toEqual([]);
		logMessage.mockRestore();
	});

	it("saves nothing over restored QuickAdd 2 settings", async () => {
		const { plugin, disk, files } = pluginOn(v3File);
		await plugin.loadSettings();
		plugin.settings.v3Migration = { migratedIn: "3.0.0", snapshot: "data.v2.json" };
		files["plugin/data.v2.json"] = new TextEncoder().encode('{"choices":[]}').buffer;
		await plugin.restoreV2Snapshot();

		expect(new TextDecoder().decode(files["plugin/data.json"])).toBe('{"choices":[]}');
		const before = disk();
		await plugin.saveSettings();
		expect(disk()).toBe(before);
	});

	it("keeps saving when the restore could not write the snapshot back", async () => {
		const { plugin, disk, files } = pluginOn(v3File);
		await plugin.loadSettings();
		plugin.settings.v3Migration = { migratedIn: "3.0.0", snapshot: "data.v2.json" };
		files["plugin/data.v2.json"] = new TextEncoder().encode('{"choices":[]}').buffer;
		const writeBinary = plugin.app.vault.adapter.writeBinary as ReturnType<typeof vi.fn>;
		writeBinary.mockRejectedValueOnce(new Error("disk full"));

		await expect(plugin.restoreV2Snapshot()).rejects.toThrow("disk full");

		plugin.settings.choices[0].name = "Still saved";
		await plugin.saveSettings();
		expect(JSON.stringify(disk())).toContain("Still saved");
	});
});
