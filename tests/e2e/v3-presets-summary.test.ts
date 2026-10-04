import { afterEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { MultiChoice } from "../../src/types/choices/MultiChoice";
import type IChoice from "../../src/types/choices/IChoice";
import type { Action, ActionNode, AddToNoteStep } from "../../src/v3/model";
import { createQuickAddE2EHarness } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, jsLiteral, leaveSettingsPage, POLL_OPTS, pressKey, waitForElement } from "./uiHelpers";

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
	await clickWhenStill(obsidian, ".qaNewChoiceBtn.mod-cta");
	await waitForElement(obsidian, ".menu .menu-item");
	await obsidian.dev.evalJson(`(() => {
		const item = [...document.querySelectorAll(".menu .menu-item")]
			.find((el) => el.textContent.trim().startsWith("Log with a timestamp"));
		item.setAttribute("data-qa-preset", "log");
		return true;
	})()`);
	await clickWhenStill(obsidian, '.menu-item[data-qa-preset="log"]');
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
