import { afterEach, beforeEach, expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import type { ActionNode } from "../../src/v3/model";
import { createQuickAddE2EHarness } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, POLL_OPTS } from "./uiHelpers";

// A new user's empty list offers three choices that run on an empty vault; one
// click adds them, and the Log one writes to today's daily note straight away.
const getContext = createQuickAddE2EHarness("v3-first-run");

type Data = { choices: IChoice[]; actions: ActionNode[] };
interface DailyNotesState { enabled: boolean; options: unknown }
let original: DailyNotesState;

async function setDailyNotes(state: DailyNotesState): Promise<void> {
	const { obsidian } = getContext();
	await obsidian.dev.evalJsonAsync(`(async () => {
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		const state = ${JSON.stringify(state)};
		if (state.enabled && !plugin.enabled) await plugin.enable(true);
		if (!state.enabled && plugin.enabled) await plugin.disable(true);
		plugin.instance.options = state.options;
		return true;
	})()`);
}

beforeEach(async () => {
	const { obsidian } = getContext();
	original = await obsidian.dev.evalJson<DailyNotesState>(`(() => {
		const plugin = app.internalPlugins.getPluginById("daily-notes");
		return { enabled: plugin.enabled, options: plugin.instance.options };
	})()`);
});

afterEach(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson("app.setting.close(), true");
	await setDailyNotes(original);
});

it("starts an empty list with three choices, and the Log one writes to today's daily note", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices = [];
	}));
	await plugin.reload({ waitUntilReady: true });
	const folder = sandbox.path("Daily");
	await setDailyNotes({ enabled: true, options: { folder, format: "YYYY-MM-DD", template: "" } });

	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await clickWhenStill(obsidian, 'button.mod-cta[aria-label="Start with three choices"]');

	const rows = () => obsidian.dev.evalJson<Array<[string, string]>>(`[...document.querySelectorAll("[data-choice-id]")]
		.map((row) => [row.querySelector(".choiceListItemName")?.textContent?.trim() ?? "", row.querySelector(".choiceListItemSummary")?.textContent ?? ""])`);
	await expect.poll(rows, POLL_OPTS).toEqual([
		["Log", "Adds a line under ## Log in today's daily note"],
		["Task", "Adds a task under ## Tasks in today's daily note"],
		["Add to note", "Adds a line at the bottom of a chosen note"],
	]);
	await expect.poll(async () => (await plugin.data<Data>().read()).actions.map((node) => node.name), POLL_OPTS)
		.toEqual(["Log", "Task", "Add to note"]);
	await obsidian.dev.evalJson("app.setting.close(), true");

	const outcome = await obsidian.execJson("quickadd:run", {
		choice: "Log", verify: true, vars: JSON.stringify({ value: "Planted the tomatoes" }),
	});
	const today = await obsidian.dev.evalJson<string>('window.moment().format("YYYY-MM-DD")');
	expect(outcome).toMatchObject({ ok: true, verified: true, file: `${folder}/${today}.md` });
	await expect.poll(() => sandbox.read(`Daily/${today}.md`), POLL_OPTS)
		.toMatch(/^## Log\n- \d{2}:\d{2} Planted the tomatoes\n?$/);
});
