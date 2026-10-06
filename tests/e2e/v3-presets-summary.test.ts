import { afterEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type { Action, ActionNode, AddToNoteStep } from "../../src/v3/model";
import { createQuickAddE2EHarness } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { jsLiteral, leaveSettingsPage, pickMenuItem, POLL_OPTS, pressKey, waitForElement } from "./uiHelpers";

// A preset from the New choice menu is stored as the action it describes, and
// the line that says what it does shows under its name in the settings list
// and in the launcher.
const getContext = createQuickAddE2EHarness("v3-presets-summary");

type Data = { choices: IChoice[]; actions: ActionNode[] };

const LOG_SUMMARY = "Adds a line under ## Log in today's daily note";

afterEach(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson("app.setting.close(), true");
});

it("adds a daily-note log from its preset and says what it does in the list and the launcher", async () => {
	const { obsidian, plugin } = getContext();
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		const inbox = new CaptureChoice("Inbox");
		inbox.captureTo = "Inbox.md";
		data.choices = [new MultiChoice("Projects").addChoice(inbox)];
	}));
	await plugin.reload({ waitUntilReady: true });

	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await pickMenuItem(obsidian, ".qaNewChoiceBtn.mod-cta", "Log with a timestamp");
	// The builder opens on the new choice; leaving it saves.
	await leaveSettingsPage(obsidian);

	const stored = async () =>
		(await plugin.data<Data>().read()).actions.find((node): node is Action => node.name === "Log");
	await expect.poll(async () => (await stored())?.steps.map((step) => step.type), POLL_OPTS).toEqual(["addToNote"]);
	const step = (await stored())!.steps[0] as AddToNoteStep;
	expect(step.captureTo).toBe("{{DAILY}}");
	expect(step.insertAfter.after).toBe("## Log");
	const id = (await stored())!.id;

	const summaryOf = (choiceId: string) =>
		obsidian.dev.evalJson<string | null>(
			`document.querySelector(${jsLiteral(`[data-choice-id="${choiceId}"] .choiceListItemSummary`)})?.textContent ?? null`,
		);
	await expect.poll(() => summaryOf(id), POLL_OPTS).toBe(LOG_SUMMARY);
	const projectsId = (await plugin.data<Data>().read()).actions.find((node) => node.name === "Projects")!.id;
	expect(await summaryOf(projectsId)).toBe("1 choice");

	await obsidian.dev.evalJson("app.setting.close(), true");
	await obsidian.dev.evalJson("app.commands.executeCommandById('quickadd:runQuickAdd'), true");
	try {
		await waitForElement(obsidian, ".quickadd-choice-suggestion");
		const note = await obsidian.dev.evalJson<string | null>(`(() => {
			const row = [...document.querySelectorAll(".quickadd-choice-suggestion")]
				.find((el) => el.querySelector(".suggestion-title")?.textContent === "Log");
			return row?.querySelector(".suggestion-note")?.textContent ?? null;
		})()`);
		expect(note).toContain(LOG_SUMMARY);
	} finally {
		await pressKey(obsidian, "Escape");
	}
});

it("says what the new presets do: selection, property, the two new notes, and AI", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await plugin.data<Data & { disableOnlineFeatures: boolean; templateFolderPaths: string[] }>().patch(withStoredChoices((data) => {
		data.choices = [];
		data.disableOnlineFeatures = false;
		data.templateFolderPaths = [sandbox.path("Templates")];
	}));
	await plugin.reload({ waitUntilReady: true });
	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");

	const presets = ["Save the selection or clipboard", "Fill in a property", "New note from a template", "New note of a type", "Ask AI"];
	for (const [index, label] of presets.entries()) {
		// The empty list's New choice is the quiet one; after that, the bar's.
		// Alt adds the choice without opening its builder.
		await pickMenuItem(obsidian, index === 0 ? ".qaFirstRunScratch .qaNewChoiceBtn" : ".qaNewChoiceBtn.mod-cta", label, { alt: true });
		await expect.poll(() => obsidian.dev.evalJson<number>('document.querySelectorAll("[data-choice-id]").length'), POLL_OPTS).toBe(index + 1);
	}

	const rows = () => obsidian.dev.evalJson<Array<[string, string]>>(`[...document.querySelectorAll("[data-choice-id]")]
		.map((row) => [row.querySelector(".choiceListItemName")?.textContent?.trim() ?? "", row.querySelector(".choiceListItemSummary")?.textContent ?? ""])`);
	await expect.poll(rows, POLL_OPTS).toEqual([
		["Save selection", "Adds the selection at the bottom of a chosen note"],
		["Property", "Sets a chosen property in the current note"],
		["New note", "Creates {title}, opens it"],
		["Typed note", "Creates {folder}/{title} from {Template}, opens it"],
		["Ask AI", "Asks AI for {output}"],
	]);
	const typed = async () =>
		(await plugin.data<Data>().read()).actions.find((node): node is Action => node.name === "Typed note")?.steps[0];
	await expect.poll(typed, POLL_OPTS).toMatchObject({
		type: "createNote",
		templatePath: `{{FILE:${sandbox.path("Templates")}|path|label:Template}}`,
	});
});
