import { afterEach, beforeEach, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/settings";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { jsLiteral, POLL_OPTS, waitForElement } from "./uiHelpers";

/**
 * Upgrading a QuickAdd 2 vault: QuickAdd loads a v2 data.json, keeps its bytes
 * in data.v2.json, stores the choices as actions, and keeps every command and
 * every write the same.
 */
const getContext = createQuickAddE2EHarness("v3-storage-switch");

const REMOVE_SNAPSHOTS = `(async () => {
	const dir = app.plugins.plugins.quickadd.manifest.dir;
	for (const file of (await app.vault.adapter.list(dir)).files) {
		if (/\\/data\\.v2\\.[^/]*json$/.test(file)) await app.vault.adapter.remove(file);
	}
	return true;
})()`;

// Written straight to disk below, past the harness's data patching, so the
// harness does not roll it back: keep what was there and put it back the same
// way. The harness's own data writes would make the written file its baseline.
let dataBeforeTest: string | undefined;

beforeEach(async () => {
	dataBeforeTest = await getContext().obsidian.dev.evalJsonAsync<string>(`(async () => {
		const dir = app.plugins.plugins.quickadd.manifest.dir;
		return await app.vault.adapter.read(dir + "/data.json");
	})()`);
});

afterEach(async () => {
	await getContext().obsidian.dev.evalJsonAsync(REMOVE_SNAPSHOTS);
	if (dataBeforeTest !== undefined) await loadDataJson(dataBeforeTest);
});

/**
 * Turn QuickAdd off, write data.json as another QuickAdd would have, turn it on.
 * Saves first: QuickAdd flushes a pending debounced save on unload without
 * awaiting it, and that write could land over the one below.
 */
async function loadDataJson(text: string) {
	const { obsidian } = getContext();
	await obsidian.dev.evalJsonAsync(`(async () => {
		const plugin = app.plugins.plugins.quickadd;
		const dir = plugin.manifest.dir;
		await plugin.saveSettings();
		await app.plugins.disablePlugin("quickadd");
		await app.vault.adapter.write(dir + "/data.json", ${jsLiteral(text)});
		await app.plugins.enablePlugin("quickadd");
		return true;
	})()`);
	await expect.poll(() => obsidian.dev.evalJson<boolean>("Boolean(app.plugins.plugins.quickadd?.api)"), POLL_OPTS).toBe(true);
}

const quickAddCommands = () =>
	getContext().obsidian.dev.evalJson<string[]>(
		"Object.keys(app.commands.commands).filter((id) => id.startsWith('quickadd:choice:')).sort()",
	);

it("migrates a QuickAdd 2 data.json to actions and keeps its commands and writes", async () => {
	const { obsidian, sandbox } = getContext();
	const log = sandbox.path("log.md");
	const seedLog = () => seedVaultFile(obsidian, sandbox, "log.md", "# Log\n\n## Entries\n- first\n\n## Notes\n");
	const capture = {
		id: "qa-v3-switch-capture",
		name: "Log entry",
		type: "Capture",
		command: true,
		captureTo: log,
		captureToActiveFile: false,
		activeFileWritePosition: "bottom",
		format: { enabled: true, format: "- {{VALUE}}\n" },
		insertAfter: { enabled: true, after: "## Entries", insertAtEnd: true, considerSubsections: false, createIfNotFound: false, createIfNotFoundLocation: "top" },
		prepend: false,
		task: false,
		appendLink: false,
		openFile: false,
		openFileInNewTab: { enabled: false, direction: "vertical", focus: true },
		focusExistingFileTab: true,
	};
	const template = {
		id: "qa-v3-switch-template",
		name: "New note",
		type: "Template",
		command: true,
		pickDayCommand: true,
		templatePath: "",
		fileNameFormat: { enabled: true, format: "{{VALUE}}" },
		folder: { enabled: true, folders: [sandbox.path("notes")], chooseWhenCreatingNote: false, createInSameFolderAsActiveFile: false, chooseFromSubfolders: false },
		appendLink: false,
		openFile: false,
		fileExistsBehavior: { kind: "prompt" },
	};
	const macro = {
		id: "qa-v3-switch-macro",
		name: "Log twice",
		type: "Macro",
		command: true,
		runOnStartup: false,
		macro: {
			id: "qa-v3-switch-macro-macro",
			name: "Log twice",
			commands: [
				{ id: "qa-v3-switch-nested", name: "Nested log", type: "NestedChoice", choice: { ...capture, id: "qa-v3-switch-nested-choice", name: "Nested log", command: false } },
				{ id: "qa-v3-switch-wait", name: "Wait", type: "Wait", time: 10 },
			],
		},
	};
	const folder = { id: "qa-v3-switch-folder", name: "Logs", type: "Multi", command: true, collapsed: false, choices: [capture, template] };
	const migrations = Object.fromEntries(
		Object.keys(DEFAULT_SETTINGS.migrations).map((key) => [key, key !== "migrateToV3Actions"]),
	);
	const version = await obsidian.dev.evalJson<string>("app.plugins.plugins.quickadd.manifest.version");
	// A data.json as QuickAdd 2 wrote it: tabs, key order and all.
	const v2Data = { choices: [folder, macro], announceUpdates: "none", version, migrations };
	const v2Text = `${JSON.stringify(v2Data, null, "\t")}\n`;

	// Before: the same choices, run as QuickAdd 2 data.
	await obsidian.dev.evalJsonAsync(REMOVE_SNAPSHOTS);
	await loadDataJson(JSON.stringify({ ...v2Data, migrations: { ...migrations, migrateToV3Actions: true } }));
	const commandsBefore = await quickAddCommands();
	expect(commandsBefore).toEqual([
		"quickadd:choice:qa-v3-switch-capture",
		"quickadd:choice:qa-v3-switch-folder",
		"quickadd:choice:qa-v3-switch-macro",
		"quickadd:choice:qa-v3-switch-template",
		"quickadd:choice:qa-v3-switch-template:pick-day",
	]);
	await seedLog();
	expect(await obsidian.execJson("quickadd:run", { id: capture.id, vars: JSON.stringify({ value: "second" }) })).toMatchObject({ ok: true });
	const written = await sandbox.waitForContent("log.md", (text) => text.includes("second"));
	expect(written).toBe("# Log\n\n## Entries\n- first\n- second\n\n## Notes\n");

	// The upgrade.
	await loadDataJson(v2Text);
	const state = await obsidian.dev.evalJsonAsync<{ snapshot: string | null; dataJson: Record<string, unknown>; v3Migration: unknown }>(`(async () => {
		const plugin = app.plugins.plugins.quickadd;
		const dir = plugin.manifest.dir;
		await plugin.saveSettings();
		const snapshot = (await app.vault.adapter.exists(dir + "/data.v2.json")) ? await app.vault.adapter.read(dir + "/data.v2.json") : null;
		return { snapshot, dataJson: JSON.parse(await app.vault.adapter.read(dir + "/data.json")), v3Migration: plugin.settings.v3Migration };
	})()`);
	expect(state.snapshot).toBe(v2Text);
	expect(state.dataJson).not.toHaveProperty("choices");
	expect(state.dataJson.actions).toMatchObject([
		{ kind: "folder", id: folder.id, items: [{ kind: "action", id: capture.id }, { kind: "action", id: template.id }] },
		{ kind: "action", id: macro.id, steps: [{ type: "addToNote", id: "qa-v3-switch-nested-choice" }, { type: "wait" }] },
	]);
	expect(state.v3Migration).toEqual({ migratedIn: version, snapshot: "data.v2.json" });
	expect(await quickAddCommands()).toEqual(commandsBefore);

	// The report, shown once.
	await waitForElement(obsidian, ".modal-container .modal-title");
	const report = await obsidian.dev.evalJson<{ title: string; rows: string[] }>(`(() => {
		const modal = [...document.querySelectorAll(".modal-container")].at(-1);
		return {
			title: modal.querySelector(".modal-title").textContent,
			rows: [...modal.querySelectorAll(".setting-item")].map((row) => row.textContent),
		};
	})()`);
	expect(report.title).toBe("Migrated to QuickAdd 3");
	expect(report.rows).toEqual(expect.arrayContaining([
		expect.stringMatching(/^Logs \/ Log entryAdds a line under ## Entries in .*log.*Dropped unknown settings: 'focusExistingFileTab'/),
		expect.stringMatching(/^Log twice.*Nested choice became steps: 'Nested log'/),
	]));
	await obsidian.dev.evalJson(`(() => {
		[...document.querySelectorAll(".modal-container button")].find((button) => button.textContent === "Done").click();
		return true;
	})()`);
	await expect.poll(() => obsidian.dev.evalJson<unknown>("app.plugins.plugins.quickadd.settings.v3Migration.reportDismissedIn"), POLL_OPTS)
		.toBe(version);

	// After: the migrated capture writes what the v2 one wrote.
	await seedLog();
	expect(await obsidian.execJson("quickadd:run", { id: capture.id, vars: JSON.stringify({ value: "second" }) })).toMatchObject({ ok: true });
	expect(await sandbox.waitForContent("log.md", (text) => text.includes("second"))).toBe(written);
});
