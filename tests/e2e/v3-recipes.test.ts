import { afterEach, beforeEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type { ActionNode } from "../../src/v3/model";
import { createQuickAddE2EHarness } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, insertText, jsLiteral, pickMenuItem, POLL_OPTS, pressKey, waitForElement, withoutFocusRing } from "./uiHelpers";

// The New choice menu opens the Recipes gallery, where a docs example is
// added with one click and its choices work straight away.
const getContext = createQuickAddE2EHarness("v3-recipes");

type Data = { choices: IChoice[]; actions: ActionNode[]; templateFolderPaths: string[] };

// The meeting recipe writes its templates and notes at the vault root.
const RECIPE_FILES = ["Templates/Meeting.md", "Templates/Project update.md"];

async function removeRecipeFiles(): Promise<void> {
	await getContext().obsidian.dev.evalJsonAsync(`(async () => {
		for (const path of ${jsLiteral(RECIPE_FILES)}) {
			const file = app.vault.getAbstractFileByPath(path);
			if (file) await app.vault.delete(file);
		}
		for (const path of ["Templates", "Meetings"]) {
			const folder = app.vault.getFolderByPath(path);
			if (folder && (path === "Meetings" || folder.children.length === 0)) await app.vault.delete(folder, true);
		}
		return true;
	})()`);
}

beforeEach(removeRecipeFiles);

afterEach(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(`(() => {
		document.querySelectorAll(".qa-recipes-modal .modal-header-button").forEach((button) => button.click());
		app.setting.close();
		return true;
	})()`);
	await removeRecipeFiles();
});

it("adds the meeting notes recipe from the gallery, and its command creates a meeting note", async () => {
	const { obsidian, plugin } = getContext();
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		const inbox = new CaptureChoice("Inbox");
		inbox.captureTo = "Inbox.md";
		data.choices = [inbox];
		data.templateFolderPaths = [];
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await pickMenuItem(obsidian, ".qaNewChoiceBtn.mod-cta", "Browse recipes…");

	await waitForElement(obsidian, ".qa-recipes-modal .qa-recipe-guide");
	expect(await withoutFocusRing(obsidian, ".qa-recipes-modal .qa-recipe a")).toEqual([]);

	await clickWhenStill(obsidian, '.qa-recipes-modal input[type="search"]');
	await insertText(obsidian, "meeting");
	const shown = () => obsidian.dev.evalJson<string[]>(
		'[...document.querySelectorAll(".qa-recipes-modal [data-recipe-id]")].map((card) => card.dataset.recipeId)',
	);
	await expect.poll(shown, POLL_OPTS).toEqual(["meeting-notes"]);

	await clickWhenStill(obsidian, '[data-recipe-id="meeting-notes"] .qa-recipe-add');
	const card = () => obsidian.dev.evalJson<string>(
		'document.querySelector(\'[data-recipe-id="meeting-notes"]\')?.innerText ?? ""',
	);
	await expect.poll(card, POLL_OPTS).toContain("Added");
	expect(await card()).toContain("Run New meeting from the command palette");

	// The list behind the gallery has the recipe's choices, each with its summary.
	const rows = () => obsidian.dev.evalJson<Array<[string, string]>>(`[...document.querySelectorAll(".mod-settings [data-choice-id]")]
		.map((row) => [row.querySelector(".choiceListItemName")?.textContent?.trim() ?? "", row.querySelector(".choiceListItemSummary")?.textContent ?? ""])`);
	await expect.poll(rows, POLL_OPTS).toEqual([
		["Inbox", "Adds a line at the top of Inbox"],
		["New meeting", "Creates Meetings/{date} {Meeting} from Meeting, opens it"],
		["Add project update", "Adds a line at the bottom of the current note"],
	]);
	const exists = (path: string) => obsidian.dev.evalJson<boolean>(`Boolean(app.vault.getFileByPath(${jsLiteral(path)}))`);
	expect(await exists("Templates/Meeting.md")).toBe(true);

	// New meeting is in the command palette as soon as it is added.
	await obsidian.dev.evalJson(`(() => {
		document.querySelectorAll(".qa-recipes-modal .modal-header-button").forEach((button) => button.click());
		app.setting.close();
		return true;
	})()`);
	const commandId = await obsidian.dev.evalJson<string | null>(
		'Object.values(app.commands.commands).find((command) => command.name === "QuickAdd: New meeting")?.id ?? null',
	);
	expect(commandId).toBe("quickadd:choice:qa-pkg-meeting-notes");
	await obsidian.command(commandId!).run();
	await expect.poll(() => obsidian.dev.evalJson<boolean>('Boolean(document.activeElement?.closest(".modal-container"))'), POLL_OPTS).toBe(true);
	await insertText(obsidian, "Standup");
	await pressKey(obsidian, "Enter");

	const today = await obsidian.dev.evalJson<string>('window.moment().format("YYYY-MM-DD")');
	await expect.poll(() => exists(`Meetings/${today} Standup.md`), POLL_OPTS).toBe(true);
});
