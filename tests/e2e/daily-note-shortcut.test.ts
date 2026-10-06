import { afterEach, beforeEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { clickWhenStill, leaveSettingsPage, POLL_OPTS } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// #2023: the Capture builder's "Daily note" button fills in {{DAILY}} and turns
// on creating the note, so a capture lands in the note Daily notes opens.
const getContext = createQuickAddE2EHarness("daily-note-shortcut");

interface DailyNotesState { enabled: boolean; options: unknown }
let original: DailyNotesState;

const dailyNotes = (state?: DailyNotesState) => getContext().obsidian.dev.evalJsonAsync<DailyNotesState>(`(async () => {
	const plugin = app.internalPlugins.getPluginById("daily-notes");
	const state = ${JSON.stringify(state ?? null)};
	if (state) {
		if (state.enabled && !plugin.enabled) await plugin.enable(true);
		if (!state.enabled && plugin.enabled) await plugin.disable(true);
		plugin.instance.options = state.options;
	}
	return { enabled: plugin.enabled, options: plugin.instance.options };
})()`);

beforeEach(async () => { original = await dailyNotes(); });
afterEach(async () => { await dailyNotes(original); });

async function clickButton(label: string) {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(`(() => {
		[...document.querySelectorAll(".captureChoiceBuilder button")]
			.find(b => b.textContent?.trim() === ${JSON.stringify(label)})
			.setAttribute("data-qa-target", "");
		return true;
	})()`);
	await clickWhenStill(obsidian, ".captureChoiceBuilder button[data-qa-target]");
}

it("captures into the daily note after one click on Daily note", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const template = await seedVaultFile(obsidian, sandbox, "Daily template.md", "## Log\n");
	const folder = sandbox.path("Journal");
	await dailyNotes({ enabled: true, options: { folder, format: "YYYY-MM-DD", template: template.replace(/\.md$/, "") } });
	const choice = new CaptureChoice("Daily note shortcut");
	choice.onePageInput = "never";
	choice.format = { enabled: true, format: "- {{VALUE}}" };
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => { data.choices = [choice]; }));
	await plugin.reload({ waitUntilReady: true });

	try {
		await obsidian.dev.evalJson(`(() => {
			app.setting.open(); app.setting.openTabById("quickadd");
			[...document.querySelectorAll('[aria-label="Configure ${choice.name}"]')]
				.find(el => el.getClientRects().length > 0).click();
			return true;
		})()`);
		await expect.poll(() => obsidian.dev.evalJson<boolean>(
			`Boolean(document.querySelector(".captureChoiceBuilder"))`,
		), POLL_OPTS).toBe(true);

		// An empty Where's two lines under it sit as close to each other as to the field.
		const [fieldToHint, hintToTokenHint] = await obsidian.dev.evalJson<number[]>(`(() => {
			const hint = document.querySelector(".captureChoiceBuilder .qa-field-hint:not(:empty)");
			const gap = (above, below) => Math.round(below.getBoundingClientRect().top - above.getBoundingClientRect().bottom);
			return [gap(hint.previousElementSibling, hint), gap(hint, hint.nextElementSibling)];
		})()`);
		expect(hintToTokenHint).toBe(fieldToHint);

		await clickButton("Daily note");
		await leaveSettingsPage(obsidian);
		await expect.poll(() => obsidian.dev.evalJson(
			`(({ captureTo, createFileIfItDoesntExist }) => ({ captureTo, createFileIfItDoesntExist }))(app.plugins.plugins.quickadd.settings.choices[0])`,
		), POLL_OPTS).toEqual({
			captureTo: "{{DAILY}}",
			createFileIfItDoesntExist: { enabled: true, createWithTemplate: false, template: "" },
		});

		await obsidian.exec("quickadd:run", { id: choice.id, date: "2031-02-10", "value-value": "from the shortcut" });
		await expect.poll(() => sandbox.read("Journal/2031-02-10.md").catch(() => null), POLL_OPTS)
			// Created from the daily notes template; this Capture writes to the top.
			.toBe("- from the shortcut\n## Log\n");
	} finally {
		await obsidian.dev.evalJson(`(() => {
			app.setting.close();
			return true;
		})()`);
	}
});
