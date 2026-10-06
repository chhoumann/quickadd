import { afterEach, beforeEach, expect, it } from "vitest";
import { createFromPreset, PRESETS } from "../../src/gui/choiceList/presets";
import type IChoice from "../../src/types/choices/IChoice";
import type ITemplateChoice from "../../src/types/choices/ITemplateChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, insertText, POLL_OPTS, pressKey, typeInto } from "./uiHelpers";

// A new choice asks for everything on one page, and the page says where the
// run lands before it writes: the note and heading a Capture adds to, the
// note a Template creates, and the dates read from the answers.
const getContext = createQuickAddE2EHarness("v3-ask-once");

type Data = { choices: IChoice[]; templateFolderPaths: string[] };
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

/** The open modals: their kind, and the one-page form's preview rows. */
function modals(): Promise<Array<{ onePage: boolean; rows: string[] }>> {
	return getContext().obsidian.dev.evalJson(`[...document.querySelectorAll(".modal-container")].map((modal) => ({
		onePage: modal.classList.contains("onePageInputModal"),
		rows: [...modal.querySelectorAll(".qa-onepage-preview-row")].map((row) => row.textContent.trim()),
	}))`);
}

/** The one-page form's input for the field labelled `label`. */
function field(label: string): string {
	return `.onePageInputModal .setting-item:has(> .setting-item-info [id="qa-onepage-label-${label}"]) input`;
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
	await obsidian.dev.evalJson(`(() => {
		for (const modal of document.querySelectorAll(".onePageInputModal")) {
			[...modal.querySelectorAll("button")].find((button) => button.textContent === "Cancel")?.click();
		}
		app.setting.close();
		return true;
	})()`);
	await setDailyNotes(original);
	// Journal/ is the daily notes folder, at the vault root, outside the sandbox.
	await obsidian.dev.evalJsonAsync(`(async () => {
		const folder = app.vault.getFolderByPath("Journal");
		if (folder) await app.vault.delete(folder, true);
		return true;
	})()`);
});

it("asks a first-run Log once, showing the daily note and heading it adds under", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await setDailyNotes({ enabled: true, options: { folder: "Journal", format: "YYYY-MM-DD", template: "" } });
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices = [];
		data.templateFolderPaths = [sandbox.path("Templates")];
	}));
	await plugin.reload({ waitUntilReady: true });
	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await clickWhenStill(obsidian, '.qaJobCard[data-job="journal"]');
	await clickWhenStill(obsidian, "button.mod-cta.qaCreateChoicesBtn:not([disabled])");
	await expect.poll(() => obsidian.dev.evalJson<number>('document.querySelectorAll("[data-choice-id]").length'), POLL_OPTS).toBe(2);
	await obsidian.dev.evalJson("app.setting.close(), true");

	await obsidian.command("quickadd:runQuickAdd").run();
	await expect.poll(() => obsidian.dev.evalJson<boolean>('Boolean(document.activeElement?.closest(".prompt"))'), POLL_OPTS).toBe(true);
	await insertText(obsidian, "Log");
	await obsidian.sleep(200);
	await pressKey(obsidian, "Enter");

	await expect.poll(modals, POLL_OPTS).toEqual([
		{ onePage: true, rows: [`Adds to:Journal/${today}.md under ## Log`] },
	]);
	// The preview sits in a box of its own, whatever the theme.
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const modal = document.querySelector(".onePageInputModal .modal");
		return getComputedStyle(modal.querySelector(".qa-onepage-preview")).backgroundColor !== getComputedStyle(modal).backgroundColor;
	})()`)).toBe(true);
	await expect.poll(() => obsidian.dev.evalJson<boolean>('Boolean(document.activeElement?.closest(".onePageInputModal"))'), POLL_OPTS).toBe(true);
	await insertText(obsidian, "Planted the tomatoes");
	await pressKey(obsidian, "Enter");

	await expect.poll(() => obsidian.dev.evalJsonAsync<string>(`(async () => {
		const path = "Journal/${today}.md";
		return (await app.vault.adapter.exists(path)) ? app.vault.adapter.read(path) : "";
	})()`), POLL_OPTS).toMatch(/^## Log\n- \d{2}:\d{2} Planted the tomatoes\n?$/);
	expect(await modals()).toEqual([]);
});

it("shows the date a new note's name reads from the answer, as it is typed", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const template = await seedVaultFile(obsidian, sandbox, "Templates/Note.md", "# {{VALUE:Topic}}\n");
	const preset = PRESETS.find((entry) => entry.id === "newNote")!;
	const choice = createFromPreset(preset, { templateFolder: sandbox.path("Templates") }) as ITemplateChoice;
	choice.command = true;
	choice.templatePath = template;
	choice.fileNameFormat = { enabled: true, format: "{{VDATE:When,YYYY-MM-DD}} {{VALUE:Topic}}" };
	choice.folder = { ...choice.folder, enabled: true, folders: [sandbox.path("Meetings")] };
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices = [choice];
	}));
	await plugin.reload({ waitUntilReady: true });
	const tomorrow = await obsidian.dev.evalJson<string>('window.moment().add(1, "day").format("YYYY-MM-DD")');

	await obsidian.command(`quickadd:choice:${choice.id}`).run();
	await expect.poll(modals, POLL_OPTS).toEqual([
		{ onePage: true, rows: [`Creates:${sandbox.path("Meetings")}/${today}.md`] },
	]);
	await typeInto(obsidian, field("Topic"), "Launch review");
	await typeInto(obsidian, field("When"), "tomorrow");

	await expect.poll(modals, POLL_OPTS).toEqual([{
		onePage: true,
		rows: [`Creates:${sandbox.path("Meetings")}/${tomorrow} Launch review.md`, `When:${tomorrow}`],
	}]);
	await typeInto(obsidian, field("When"), "blah");
	await expect.poll(async () => (await modals())[0]?.rows.at(-1), POLL_OPTS).toBe("When:Not a date");
});
