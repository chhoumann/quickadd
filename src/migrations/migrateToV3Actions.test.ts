import { beforeEach, describe, expect, it, vi } from "vitest";
import type QuickAdd from "src/main";
import { DEFAULT_SETTINGS } from "src/settings";
import { settingsStore } from "src/settingsStore";
import type IChoice from "src/types/choices/IChoice";
import { lowerNode } from "src/v3/lower";
import { migrateChoice } from "src/v3/migrate";
import migrate from "./migrate";

vi.mock("src/logger/logManager", () => ({
	log: { logMessage: vi.fn(), logError: vi.fn(), logWarning: vi.fn() },
}));

const DIR = ".obsidian/plugins/quickadd";
const encode = (text: string) => new TextEncoder().encode(text).buffer;
const decode = (bytes: ArrayBuffer | undefined) => (bytes ? new TextDecoder().decode(bytes) : undefined);

const capture = {
	id: "c1",
	name: "Inbox",
	type: "Capture",
	command: true,
	captureTo: "Inbox.md",
	captureToActiveFile: false,
	format: { enabled: true, format: "- {{VALUE}}" },
	insertAfter: { enabled: false, after: "", insertAtEnd: false, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "top" },
	prepend: true,
	task: false,
	appendLink: false,
	openFile: false,
	focusExistingFileTab: true,
} as unknown as IChoice;

function makePlugin(files: Record<string, ArrayBuffer>, options: { failWrites?: boolean } = {}) {
	const adapter = {
		exists: vi.fn(async (path: string) => path in files),
		readBinary: vi.fn(async (path: string) => {
			if (!(path in files)) throw new Error(`ENOENT ${path}`);
			return files[path];
		}),
		writeBinary: vi.fn(async (path: string, bytes: ArrayBuffer) => {
			if (options.failWrites) throw new Error("EACCES");
			files[path] = bytes;
		}),
	};
	const settings = structuredClone(DEFAULT_SETTINGS);
	settings.migrations = Object.fromEntries(
		Object.keys(DEFAULT_SETTINGS.migrations).map((key) => [key, true]),
	) as typeof settings.migrations;
	settings.migrations.migrateToV3Actions = false;
	settings.choices = [structuredClone(capture)];
	const plugin = {
		settings,
		saveSettings: vi.fn(),
		manifest: { dir: DIR, version: "3.0.0" },
		app: { vault: { adapter } },
	};
	return { plugin: plugin as unknown as QuickAdd, files, adapter };
}

describe("migrateToV3Actions", () => {
	beforeEach(() => settingsStore.replaceState(structuredClone(DEFAULT_SETTINGS)));

	it("runs last, after every other migration", async () => {
		const { plugin } = makePlugin({ [`${DIR}/data.json`]: encode("{}") });
		plugin.settings.migrations.pinAiModelRefs = false;
		const order: string[] = [];
		const pin = await import("./pinAiModelRefs");
		const v3 = await import("./migrateToV3Actions");
		vi.spyOn(pin.default, "migrate").mockImplementation(async () => void order.push("pinAiModelRefs"));
		const original = v3.default.migrate;
		vi.spyOn(v3.default, "migrate").mockImplementation(async (...args) => {
			order.push("migrateToV3Actions");
			return original(...args);
		});
		await migrate(plugin);
		vi.restoreAllMocks();
		expect(order).toEqual(["pinAiModelRefs", "migrateToV3Actions"]);
		expect(Object.keys(DEFAULT_SETTINGS.migrations).at(-1)).toBe("migrateToV3Actions");
	});

	it("keeps the bytes of data.json in data.v2.json and lowers the choices it migrated", async () => {
		const raw = '{"choices":[{"id":"c1"}],\n  "odd spacing": true}';
		const { plugin, files } = makePlugin({ [`${DIR}/data.json`]: encode(raw) });
		await migrate(plugin);

		expect(decode(files[`${DIR}/data.v2.json`])).toBe(raw);
		expect(plugin.settings.migrations.migrateToV3Actions).toBe(true);
		expect(plugin.settings.v3Migration).toEqual({ migratedIn: "3.0.0", snapshot: "data.v2.json" });
		expect(plugin.settings.choices).toEqual([JSON.parse(JSON.stringify(lowerNode(migrateChoice(capture).node)))]);
		expect(plugin.settings.choices[0]).not.toHaveProperty("focusExistingFileTab");
	});

	it("reads data.json before any migration can change it", async () => {
		const { plugin, files } = makePlugin({ [`${DIR}/data.json`]: encode("before") });
		plugin.settings.migrations.pinAiModelRefs = false;
		const pin = await import("./pinAiModelRefs");
		vi.spyOn(pin.default, "migrate").mockImplementation(async () => {
			files[`${DIR}/data.json`] = encode("written mid-launch");
		});
		await migrate(plugin);
		vi.restoreAllMocks();
		expect(decode(files[`${DIR}/data.v2.json`])).toBe("before");
	});

	it("never overwrites an earlier copy", async () => {
		const { plugin, files } = makePlugin({
			[`${DIR}/data.json`]: encode("new"),
			[`${DIR}/data.v2.json`]: encode("old"),
		});
		await migrate(plugin);

		expect(decode(files[`${DIR}/data.v2.json`])).toBe("old");
		const snapshot = plugin.settings.v3Migration?.snapshot ?? "";
		expect(snapshot).toMatch(/^data\.v2\.\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z\.json$/);
		expect(decode(files[`${DIR}/${snapshot}`])).toBe("new");
	});

	it("reuses a copy that holds the same bytes", async () => {
		const { plugin, adapter } = makePlugin({
			[`${DIR}/data.json`]: encode("same"),
			[`${DIR}/data.v2.json`]: encode("same"),
		});
		await migrate(plugin);

		expect(adapter.writeBinary).not.toHaveBeenCalled();
		expect(plugin.settings.v3Migration?.snapshot).toBe("data.v2.json");
	});

	it("migrates a vault without data.json and records no copy", async () => {
		const { plugin, adapter } = makePlugin({});
		await migrate(plugin);

		expect(adapter.writeBinary).not.toHaveBeenCalled();
		expect(plugin.settings.migrations.migrateToV3Actions).toBe(true);
		expect(plugin.settings.v3Migration).toEqual({ migratedIn: "3.0.0" });
	});

	it("stays pending when the copy cannot be written", async () => {
		const { plugin } = makePlugin({ [`${DIR}/data.json`]: encode("{}") }, { failWrites: true });
		await migrate(plugin);

		expect(plugin.settings.migrations.migrateToV3Actions).toBe(false);
		expect(plugin.settings.v3Migration).toBeUndefined();
		expect(plugin.settings.choices).toEqual([capture]);
	});

	it("stays pending when data.json cannot be read", async () => {
		const { plugin, adapter } = makePlugin({ [`${DIR}/data.json`]: encode("{}") });
		adapter.readBinary.mockRejectedValue(new Error("EIO"));
		await migrate(plugin);

		expect(plugin.settings.migrations.migrateToV3Actions).toBe(false);
	});

	it("stays pending while an earlier migration is", async () => {
		const { plugin, adapter } = makePlugin({ [`${DIR}/data.json`]: encode("{}") });
		plugin.settings.migrations.pinAiModelRefs = false;
		const pin = await import("./pinAiModelRefs");
		vi.spyOn(pin.default, "migrate").mockResolvedValue({ complete: false });
		await migrate(plugin);
		vi.restoreAllMocks();

		expect(plugin.settings.migrations.migrateToV3Actions).toBe(false);
		expect(adapter.writeBinary).not.toHaveBeenCalled();
	});

	it("stays pending while part of the choice tree is unreadable", async () => {
		const { plugin } = makePlugin({ [`${DIR}/data.json`]: encode("{}") });
		plugin.settings.choices = [{ id: "f", name: "Folder", type: "Multi", command: false, choices: { 0: capture } } as unknown as IChoice];
		await migrate(plugin);

		expect(plugin.settings.migrations.migrateToV3Actions).toBe(false);
	});
});
