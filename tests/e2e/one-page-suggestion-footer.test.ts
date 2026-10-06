import { afterEach, beforeEach, expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { DESCRIBE_ELEMENT, POLL_OPTS, clickAt, expectNoPrompt, pressKey, typeInto, waitForElement } from "./uiHelpers";
import { withStoredChoices } from "./storedChoices";

// The suggestion list is layered above the modal. Opened under the one-page
// form's last field, it landed on the Submit/Cancel bar, so a click on Submit
// hit the list and the form stayed open.
const getContext = createQuickAddE2EHarness("one-page-suggestion-footer");

type Rect = { top: number; bottom: number };
type Layout = {
	suggestions: string[];
	list: Rect | null;
	input: Rect;
	actions: Rect;
	submitCentre: { x: number; y: number };
	/** What a click at Submit's centre would hit. */
	atSubmit: string;
};

async function closeOpenPrompts() {
	const { obsidian } = getContext();
	for (let remaining = 10; remaining > 0; remaining--) {
		if (!await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".modal-container, .prompt"))')) break;
		await pressKey(obsidian, "Escape");
	}
	await expectNoPrompt(obsidian);
}

beforeEach(closeOpenPrompts);
afterEach(closeOpenPrompts);

type Folders = { deals: string; people: string };

// `name` is also the created note's file name; the sandbox is shared by the file's tests.
async function openForm(name: string, templateLines: (folders: Folders) => string[]) {
	const { obsidian, plugin, sandbox } = getContext();
	const deals = [["Acme", "Lead"], ["Globex", "Active"], ["Initech", "Paused"], ["Umbrella", "Done"], ["Hooli", "Proposal sent"]];
	for (const [client, stage] of deals) {
		await seedVaultFile(obsidian, sandbox, `Deals/${client}.md`, `---\nclient: ${client}\nstage: ${stage}\n---\n`);
	}
	for (const person of ["Ann", "Bob", "Cara", "Dan", "Eve", "Fay"]) {
		await seedVaultFile(obsidian, sandbox, `People/${person}.md`);
	}
	const folders = { deals: sandbox.path("Deals"), people: sandbox.path("People") };
	const template = new TemplateChoice(name);
	template.command = true;
	template.onePageInput = "always";
	template.templatePath = await seedVaultFile(obsidian, sandbox, "form-template.md", templateLines(folders).join("\n"));
	template.fileNameFormat = { enabled: true, format: name };
	template.folder = { ...template.folder, enabled: true, folders: [sandbox.path("out")] };
	await plugin.data<{ choices: IChoice[] }>().patch(withStoredChoices((data) => {
		data.choices.push(template);
	}));
	await plugin.reload({ waitUntilReady: true });
	await obsidian.exec("command", { id: `quickadd:choice:${template.id}` });
	await waitForElement(obsidian, ".onePageInputModal");
	return (field: string, label: string) =>
		`.onePageInputModal input[aria-labelledby=${JSON.stringify(
			`qa-onepage-label-${encodeURIComponent(`FIELD:${field}|folder:${folders.deals}|label:${label}`)}`,
		)}]`;
}

async function layout(inputSelector: string): Promise<Layout> {
	return getContext().obsidian.dev.evalJson<Layout>(`(() => {
		${DESCRIBE_ELEMENT}
		const rect = (el) => {
			const { top, bottom } = el.getBoundingClientRect();
			return { top, bottom };
		};
		const input = document.querySelector(${JSON.stringify(inputSelector)});
		const actions = input.closest(".modal").querySelector(".qa-prompt-actions");
		const submit = Array.from(actions.querySelectorAll("button")).find((button) => button.textContent === "Submit");
		const box = submit.getBoundingClientRect();
		const x = box.left + box.width / 2;
		const y = box.top + box.height / 2;
		const hit = document.elementFromPoint(x, y);
		const list = document.querySelector(".suggestion-container");
		return {
			suggestions: Array.from(document.querySelectorAll(".suggestion-container .suggestion-item"))
				.map((item) => (item.querySelector(".qa-onepage-file-suggestion__label") ?? item).textContent),
			list: list ? rect(list) : null,
			input: rect(input),
			actions: rect(actions),
			submitCentre: { x, y },
			atSubmit: submit.contains(hit) ? "Submit" : describe(hit),
		};
	})()`);
}

it("keeps Submit clickable while the last field's suggestions are open", async () => {
	const { obsidian, sandbox } = getContext();
	const field = await openForm("deal", ({ deals }) => [
		"---",
		`client: {{FIELD:client|folder:${deals}|label:Which client?}}`,
		`contact: {{FIELD:contact|folder:${deals}|label:Who did you talk to?}}`,
		`stage: {{FIELD:stage|folder:${deals}|label:Where does the deal stand?}}`,
		"date: {{DATE:YYYY-MM-DD}}",
		"---",
		"",
	]);
	const client = field("client", "Which client?");
	const stage = field("stage", "Where does the deal stand?");

	// A list with room between its input and the action bar still opens below.
	await typeInto(obsidian, client, "Acme");
	await expect.poll(async () => (await layout(client)).suggestions, POLL_OPTS).toEqual(["Acme"]);
	const clientLayout = await layout(client);
	expect(clientLayout.list?.top).toBeGreaterThanOrEqual(clientLayout.input.bottom);

	await typeInto(obsidian, field("contact", "Who did you talk to?"), "Jane");
	await typeInto(obsidian, stage, "Lead");
	await expect.poll(async () => (await layout(stage)).suggestions, POLL_OPTS).toEqual(["Lead"]);
	const stageLayout = await layout(stage);
	expect(stageLayout.list?.bottom).toBeLessThanOrEqual(stageLayout.actions.top);
	expect(stageLayout.atSubmit).toBe("Submit");

	await clickAt(obsidian, stageLayout.submitCentre.x, stageLayout.submitCentre.y);
	await expectNoPrompt(obsidian);
	await expect.poll(() => sandbox.read("out/deal.md").catch(() => ""), POLL_OPTS)
		.toMatch(/^---\nclient: Acme\ncontact: Jane\nstage: Lead\ndate: \d{4}-\d{2}-\d{2}\n---\n$/);
});

it("re-places the list when a multi-select FILE pick keeps it open", async () => {
	const { obsidian, sandbox } = getContext();
	const field = await openForm("meeting", ({ deals, people }) => [
		`people: {{FILE:${people}|multi|label:Who was there?}}`,
		`client: {{FIELD:client|folder:${deals}|label:Which client?}}`,
		"",
	]);
	const picker = ".onePageInputModal .qa-onepage-file-picker__input";
	await typeInto(obsidian, field("client", "Which client?"), "Acme");

	// One match fits between the picker and the action bar, so it opens below.
	await typeInto(obsidian, picker, "Fay");
	await expect.poll(async () => (await layout(picker)).suggestions, POLL_OPTS).toEqual(["Fay"]);
	const filtered = await layout(picker);
	expect(filtered.list?.top).toBeGreaterThanOrEqual(filtered.input.bottom);

	// The pick clears the search and refreshes the open list in place with every
	// other person; below the picker that list would reach the action bar.
	await pressKey(obsidian, "Enter");
	await expect.poll(async () => (await layout(picker)).suggestions.sort(), POLL_OPTS)
		.toEqual(["Ann", "Bob", "Cara", "Dan", "Eve"]);
	const refreshed = await layout(picker);
	expect(refreshed.list?.bottom).toBeLessThanOrEqual(refreshed.input.top);
	expect(refreshed.atSubmit).toBe("Submit");

	await clickAt(obsidian, refreshed.submitCentre.x, refreshed.submitCentre.y);
	await expectNoPrompt(obsidian);
	await expect.poll(() => sandbox.read("out/meeting.md").catch(() => ""), POLL_OPTS)
		.toBe("people: Fay\nclient: Acme\n");
});
