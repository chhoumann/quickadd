import { afterEach, beforeEach, expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, clickAt, expectNoPrompt, pressKey, typeInto, waitForElement } from "./uiHelpers";

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
	submitIsHit: boolean;
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

async function openDealForm() {
	const { obsidian, plugin, sandbox } = getContext();
	const deals = [["Acme", "Lead"], ["Globex", "Active"], ["Initech", "Paused"], ["Umbrella", "Done"], ["Hooli", "Proposal sent"]];
	for (const [client, stage] of deals) {
		await seedVaultFile(obsidian, sandbox, `Deals/${client}.md`, `---\nclient: ${client}\nstage: ${stage}\n---\n`);
	}
	const scope = `folder:${sandbox.path("Deals")}`;
	const template = new TemplateChoice("Deal form");
	template.command = true;
	template.onePageInput = "always";
	template.templatePath = await seedVaultFile(obsidian, sandbox, "deal-template.md", [
		"---",
		`client: {{FIELD:client|${scope}|label:Which client?}}`,
		`contact: {{FIELD:contact|${scope}|label:Who did you talk to?}}`,
		`stage: {{FIELD:stage|${scope}|label:Where does the deal stand?}}`,
		"date: {{DATE:YYYY-MM-DD}}",
		"---",
		"",
	].join("\n"));
	template.fileNameFormat = { enabled: true, format: "deal" };
	template.folder = { ...template.folder, enabled: true, folders: [sandbox.path("out")] };
	await plugin.data<{ choices: IChoice[] }>().patch((data) => {
		data.choices.push(template);
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.exec("command", { id: `quickadd:choice:${template.id}` });
	await waitForElement(obsidian, ".onePageInputModal");
	return (field: string, label: string) =>
		`.onePageInputModal input[aria-labelledby=${JSON.stringify(
			`qa-onepage-label-${encodeURIComponent(`FIELD:${field}|${scope}|label:${label}`)}`,
		)}]`;
}

async function layout(inputSelector: string): Promise<Layout> {
	return getContext().obsidian.dev.evalJson<Layout>(`(() => {
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
		const list = document.querySelector(".suggestion-container");
		return {
			suggestions: Array.from(document.querySelectorAll(".suggestion-container .suggestion-item")).map((item) => item.textContent),
			list: list ? rect(list) : null,
			input: rect(input),
			actions: rect(actions),
			submitCentre: { x, y },
			submitIsHit: submit.contains(document.elementFromPoint(x, y)),
		};
	})()`);
}

it("keeps Submit clickable while the last field's suggestions are open", async () => {
	const { obsidian, sandbox } = getContext();
	const field = await openDealForm();
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
	expect(stageLayout.submitIsHit).toBe(true);

	await clickAt(obsidian, stageLayout.submitCentre.x, stageLayout.submitCentre.y);
	await expectNoPrompt(obsidian);
	await expect.poll(() => sandbox.read("out/deal.md").catch(() => ""), POLL_OPTS)
		.toMatch(/^---\nclient: Acme\ncontact: Jane\nstage: Lead\ndate: \d{4}-\d{2}-\d{2}\n---\n$/);
});
