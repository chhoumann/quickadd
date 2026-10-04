import { afterEach, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import type { Action, ActionNode } from "../../src/v3/model";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { withStoredChoices } from "./storedChoices";
import { clickWhenStill, expectNoPrompt, POLL_OPTS, pressKey, typeInto, waitForElement } from "./uiHelpers";

// The builder's Inputs group lists what a run asks for, read from the
// placeholders, and its Label override is what the run's prompt then says.
const getContext = createQuickAddE2EHarness("v3-inputs");

type Data = { choices: IChoice[]; actions: ActionNode[]; onePageInputEnabled: boolean };

afterEach(async () => {
	const { obsidian } = getContext();
	for (let remaining = 5; remaining > 0; remaining--) {
		if (!(await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".modal-container .prompt, .modal-container input"))'))) break;
		await pressKey(obsidian, "Escape");
	}
	await obsidian.dev.evalJson("app.setting.close(), true");
});

const openBuilder = async (name: string) => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson("app.setting.open(), app.setting.openTabById('quickadd'), true");
	await clickWhenStill(obsidian, `[aria-label="Configure ${name}"]`);
};

/** The rows of the open builder's Inputs group, as a user reads them. */
const inputRows = () =>
	getContext().obsidian.dev.evalJson<string[]>(`[...document.querySelectorAll(".qa-builder-page .qaInputRow")]
		.filter((row) => row.getClientRects().length > 0)
		.map((row) => row.querySelector(".setting-item-info").innerText.replace(/\\s+/g, " ").trim())`);

it("lists a capture's two inputs, and its prompt asks with the label set there", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	await seedVaultFile(obsidian, sandbox, "visits.md", "# Visits\n");
	const capture = new CaptureChoice("Visit log");
	capture.id = "qa-inputs-visit-log";
	capture.command = true;
	capture.captureTo = sandbox.path("visits.md");
	capture.format = { enabled: true, format: "- {{VALUE:Guest}} on {{VDATE:Day,YYYY-MM-DD}}\n" };
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.onePageInputEnabled = false;
		data.choices = [capture];
	}));
	await plugin.reload({ waitUntilReady: true });

	await openBuilder("Visit log");
	await expect.poll(inputRows, POLL_OPTS).toEqual([
		"Guest value Defined in the format",
		"Day date Defined in the format",
	]);

	await typeInto(obsidian, '.qa-builder-page .qaInputRow[data-input="Guest"] input[aria-label="Label"]', "Who visited?");
	await clickWhenStill(obsidian, ".setting-page-back-button");
	await obsidian.dev.evalJson("app.setting.close(), true");
	await expect.poll(async () => {
		const action = (await plugin.data<Data>().read()).actions.find((node): node is Action => node.id === capture.id);
		return action?.inputs;
	}, POLL_OPTS).toEqual({ Guest: { label: "Who visited?" } });

	// The run asks for dates before named values.
	const promptTitle = () => obsidian.dev.evalJson<string>(
		'document.querySelector(".modal-container .modal-title")?.textContent ?? ""',
	);
	await obsidian.exec("command", { id: `quickadd:choice:${capture.id}` });
	await waitForElement(obsidian, ".modal-container input");
	await expect.poll(promptTitle, POLL_OPTS).toBe("Day");
	await typeInto(obsidian, ".modal-container input", "2026-10-04");
	await pressKey(obsidian, "Enter");
	await expect.poll(promptTitle, POLL_OPTS).toBe("Who visited?");
	await typeInto(obsidian, ".modal-container input", "Ada");
	await pressKey(obsidian, "Enter");
	await sandbox.waitForContent("visits.md", (text) => text.includes("- Ada on 2026-10-04\n"));
	await expectNoPrompt(obsidian);
});

it("names the template file a template's input is defined in", async () => {
	const { obsidian, plugin, sandbox } = getContext();
	const template = new TemplateChoice("Guest note");
	template.templatePath = await seedVaultFile(obsidian, sandbox, "Guest template.md", "Guest: {{VALUE:Guest}}\n");
	template.fileNameFormat = { enabled: true, format: "Guest {{DATE:YYYY-MM-DD}}" };
	await plugin.data<Data>().patch(withStoredChoices((data) => {
		data.choices = [template];
	}));
	await plugin.reload({ waitUntilReady: true });

	await openBuilder("Guest note");
	await expect.poll(inputRows, POLL_OPTS).toEqual(["Guest value Defined in Guest template.md"]);
	expect(await obsidian.dev.evalJson<string>(
		'document.querySelector(".qa-builder-page .qaInputRow a")?.textContent ?? ""',
	)).toBe("Guest template.md");
});
