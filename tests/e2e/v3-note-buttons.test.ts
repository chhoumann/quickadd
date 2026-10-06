import { afterEach, beforeEach, expect, it } from "vitest";
import { logCapture, taskCapture } from "../../src/gui/choiceList/presets";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, insertText, jsLiteral, leaveSettingsPage, POLL_OPTS, pressKey } from "./uiHelpers";

// A quickadd block in a note renders as buttons that run choices, and the
// buttons follow the choices as they are renamed.
const getContext = createQuickAddE2EHarness("v3-note-buttons");

interface DailyNotesState { enabled: boolean; options: unknown }
let original: DailyNotesState;
let today: string;

async function setDailyNotes(state: DailyNotesState): Promise<void> {
	await getContext().obsidian.dev.evalJsonAsync(`(async () => {
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		const state = ${JSON.stringify(state)};
		if (state.enabled && !plugin.enabled) await plugin.enable(true);
		if (!state.enabled && plugin.enabled) await plugin.disable(true);
		plugin.instance.options = state.options;
		return true;
	})()`);
}

const BUTTON = ".markdown-reading-view .qa-note-button";

function buttons(): Promise<Array<{ label: string; title: string; disabled: boolean; icon: boolean }>> {
	return getContext().obsidian.dev.evalJson(`[...document.querySelectorAll(${jsLiteral(BUTTON)})]
		.filter((el) => el.getClientRects().length > 0)
		.map((el) => ({ label: el.textContent, title: el.title, disabled: el.disabled, icon: Boolean(el.querySelector(".qa-note-button-icon svg")) }))`);
}

beforeEach(async () => {
	const { obsidian } = getContext();
	original = await obsidian.dev.evalJson<DailyNotesState>(`(() => {
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		return { enabled: plugin.enabled, options: plugin.instance.options };
	})()`);
	today = await obsidian.dev.evalJson<string>('window.moment().format("YYYY-MM-DD")');
});

afterEach(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson("app.setting.close(), true");
	await setDailyNotes(original);
});

it("runs a choice from a button in a note, and the button follows a rename", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await setDailyNotes({ enabled: true, options: { folder: sandbox.path("Daily"), format: "YYYY-MM-DD", template: "" } });
	const log = logCapture("Log");
	log.id = "qa-buttons-log";
	const task = taskCapture("Task");
	task.id = "qa-buttons-task";
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices = [log, task];
	}));
	await plugin.reload({ waitUntilReady: true });

	const dashboard = await seedVaultFile(obsidian, sandbox, "Dashboard.md",
		"# Dashboard\n\n```quickadd\nLog | Journal\nTask\n# By id, so a rename keeps it\nid: qa-buttons-log\n```\n");
	await obsidian.dev.evalJsonAsync(`(async () => {
		const leaf = app.workspace.getLeaf(true);
		await leaf.openFile(app.vault.getAbstractFileByPath(${jsLiteral(dashboard)}), { state: { mode: "preview" } });
		return true;
	})()`);

	await expect.poll(buttons, POLL_OPTS).toEqual([
		{ label: "Journal", title: "Adds a line under ## Log in today's daily note", disabled: false, icon: true },
		{ label: "Task", title: "Adds a task under ## Tasks in today's daily note", disabled: false, icon: true },
		{ label: "Log", title: "Adds a line under ## Log in today's daily note", disabled: false, icon: true },
	]);

	await clickWhenStill(obsidian, `${BUTTON}:first-of-type`);
	await expect.poll(() => obsidian.dev.evalJson<boolean>('Boolean(document.activeElement?.closest(".modal-container"))'), POLL_OPTS).toBe(true);
	// The button stays disabled while its choice runs.
	expect((await buttons()).map((b) => b.disabled)).toEqual([true, false, true]);
	await insertText(obsidian, "Watered the tomatoes");
	await pressKey(obsidian, "Enter");
	await expect.poll(() => sandbox.read(`Daily/${today}.md`).catch(() => ""), POLL_OPTS)
		.toMatch(/^## Log\n- \d{2}:\d{2} Watered the tomatoes\n?$/);
	await expect.poll(async () => (await buttons()).map((b) => b.disabled), POLL_OPTS).toEqual([false, false, false]);

	// Rename Log in settings; the open note follows.
	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await clickWhenStill(obsidian, '[aria-label="Configure Log"]');
	await obsidian.dev.evalJson(`(() => {
		const input = document.querySelector(".qa-builder-page .setting-group input");
		input.focus();
		input.select();
		return true;
	})()`);
	await insertText(obsidian, "Journal entry");
	await leaveSettingsPage(obsidian);
	await obsidian.dev.evalJson("app.setting.close(), true");

	await expect.poll(async () => (await buttons()).map(({ label, disabled }) => [label, disabled]), POLL_OPTS).toEqual([
		["No choice named 'Log'", true],
		["Task", false],
		["Journal entry", false],
	]);
});
