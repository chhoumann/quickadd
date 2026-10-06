import { afterEach, beforeEach, expect, it } from "vitest";
import type { ObsidianClient } from "obsidian-e2e";
import type IChoice from "../../src/types/choices/IChoice";
import type { ActionNode } from "../../src/v3/model";
import { createQuickAddE2EHarness } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, jsLiteral, leaveSettingsPage, pickMenuItem, POLL_OPTS, pressKey, typeInto, waitForElement } from "./uiHelpers";

// "New note from a template" opens the compact builder: what the choice does
// at the top, the essentials under it, everything else behind More settings.
const getContext = createQuickAddE2EHarness("v3-compact-builder");

type Data = { choices: IChoice[]; actions: ActionNode[]; templateFolderPaths: string[] };

const TEMPLATE = "Templates/Meeting.md";

/** Remove what a run made outside the sandbox: the template, and its folder if the run made that too. */
const removeTemplate = (obsidian: ObsidianClient, folderExisted: boolean) =>
	obsidian.dev.evalJsonAsync<boolean>(`(async () => {
		const file = app.vault.getAbstractFileByPath(${jsLiteral(TEMPLATE)});
		if (file) await app.vault.delete(file);
		const folder = app.vault.getAbstractFileByPath("Templates");
		if (!${folderExisted} && folder && folder.children.length === 0) await app.vault.delete(folder, true);
		return true;
	})()`);

let templatesFolderExisted = true;

beforeEach(async () => {
	const { obsidian } = getContext();
	templatesFolderExisted = await obsidian.dev.evalJson<boolean>('app.vault.getAbstractFileByPath("Templates") !== null');
	expect(await obsidian.dev.evalJson<boolean>(`app.vault.getAbstractFileByPath(${jsLiteral(TEMPLATE)}) === null`)).toBe(true);
});

afterEach(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson("app.setting.close(), true");
	await removeTemplate(obsidian, templatesFolderExisted);
});

const visible = (obsidian: ObsidianClient, selector: string) =>
	obsidian.dev.evalJson<string[]>(`[...document.querySelectorAll(${jsLiteral(selector)})]
		.filter((el) => el.getClientRects().length > 0).map((el) => el.textContent.trim())`);
const summary = async (obsidian: ObsidianClient) => (await visible(obsidian, ".qa-builder-page .qaChoiceSummary"))[0];
const rowNames = (obsidian: ObsidianClient) =>
	obsidian.dev.evalJson<string[]>(`[...document.querySelectorAll(".qa-builder-page .setting-item-name")]
		.filter((el) => el.getClientRects().length > 0 && !el.closest(".qaInputRow")).map((el) => el.textContent.trim())`);

/** Mark the visible builder row named `name`, to click a part of it. */
async function markRow(obsidian: ObsidianClient, name: string, mark: string) {
	await obsidian.dev.evalJson(`(() => {
		const row = [...document.querySelectorAll(".qa-builder-page .setting-item")]
			.find((el) => el.getClientRects().length > 0 && el.querySelector(":scope > .setting-item-info > .setting-item-name")?.textContent.trim() === ${jsLiteral(name)});
		row.setAttribute("data-qa-row", ${jsLiteral(mark)});
		return true;
	})()`);
}

it("makes a note from a new template in the compact builder", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices = [];
		data.templateFolderPaths = [];
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await pickMenuItem(obsidian, ".qaFirstRunScratch .qaNewChoiceBtn", "New note from a template");
	await waitForElement(obsidian, ".qa-builder-page .qaChoiceSummary");

	expect(await summary(obsidian)).toBe("Creates {title}, opens it");
	// Opening the note is set behind More settings, so they show.
	await expect.poll(async () => (await rowNames(obsidian)).slice(0, 8), POLL_OPTS)
		.toEqual(["Name", "Template", "Folder", "Note name", "Inputs", "Steps", "More settings", "Location"]);

	await clickWhenStill(obsidian, ".qa-builder-page .qaNewTemplateButton");
	await waitForElement(obsidian, ".qaInputPrompt input");
	await typeInto(obsidian, ".qaInputPrompt input", "Meeting");
	await pressKey(obsidian, "Enter");

	await expect.poll(() => obsidian.dev.evalJson<boolean>(`app.vault.getAbstractFileByPath(${jsLiteral(TEMPLATE)}) !== null`), POLL_OPTS).toBe(true);
	expect(await obsidian.dev.evalJsonAsync<string>(`app.vault.read(app.vault.getAbstractFileByPath(${jsLiteral(TEMPLATE)}))`))
		.toBe("# {{VALUE:Title}}\n\n");
	const templateField = () => obsidian.dev.evalJson<string>(`(() => {
		const label = [...document.querySelectorAll(".qa-builder-page label.setting-item-name")].find((el) => el.textContent.trim() === "Template");
		return document.getElementById(label.htmlFor).value;
	})()`);
	await expect.poll(templateField, POLL_OPTS).toBe(TEMPLATE);
	await expect.poll(() => summary(obsidian), POLL_OPTS).toBe("Creates {title} from Meeting, opens it");
	// The template opened in a tab behind settings, which stay open.
	expect(await obsidian.dev.evalJson<boolean>(`app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view.file?.path === ${jsLiteral(TEMPLATE)})`)).toBe(true);
	expect(await obsidian.dev.evalJson<number>("app.setting.pageStack.length")).toBe(1);

	// The preset opens the note it creates.
	await markRow(obsidian, "Open", "open");
	expect(await obsidian.dev.evalJson<boolean>(
		'document.querySelector(\'[data-qa-row="open"] .checkbox-container\').classList.contains("is-enabled")',
	)).toBe(true);

	// Into the sandbox, so the note the run makes goes with it.
	const folder = sandbox.path("Meetings");
	await markRow(obsidian, "Folder", "folder");
	await typeInto(obsidian, '[data-qa-row="folder"] input', folder);
	// Done typing: leave the field, which closes its suggestions.
	await obsidian.dev.evalJson("document.activeElement.blur(), true");
	await expect.poll(() => summary(obsidian), POLL_OPTS).toBe(`Creates ${folder}/{title} from Meeting, opens it`);

	await leaveSettingsPage(obsidian);
	const id = await obsidian.dev.evalJson<string>('document.querySelector("[data-choice-id]").dataset.choiceId');
	await obsidian.dev.evalJson("app.setting.close(), true");

	expect(await obsidian.execJson("quickadd:run", { id, verify: true, vars: JSON.stringify({ value: "Standup", Title: "Standup" }) }))
		.toMatchObject({ ok: true });
	await expect.poll(() => sandbox.read("Meetings/Standup.md"), POLL_OPTS).toBe("# Standup\n\n");
	await expect.poll(() => obsidian.dev.evalJson<string | null>("app.workspace.getActiveFile()?.path ?? null"), POLL_OPTS)
		.toBe(`${folder}/Standup.md`);
});
