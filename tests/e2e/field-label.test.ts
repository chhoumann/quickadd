import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, expectNoPrompt, pressKey, typeInto, waitForElement } from "./uiHelpers";

// #1797: `{{FIELD:...|label:...}}` words the prompt instead of "Enter value for
// <field>", and two labels on the same property ask two separate questions.
const getContext = createQuickAddE2EHarness("field-label");

type QuickAddData = {
	choices: IChoice[];
	onePageInputEnabled: boolean;
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

async function runCallTemplate(onePage: boolean) {
	const { obsidian, plugin, sandbox } = getContext();
	await seedVaultFile(obsidian, sandbox, "Projects/Website.md", "---\nclient: Northwind\n---\n");
	await seedVaultFile(obsidian, sandbox, "Projects/App.md", "---\nclient: Globex\n---\n");
	const scope = `folder:${sandbox.path("Projects")}`;
	const mode = onePage ? "form" : "prompts";
	const template = new TemplateChoice(`Call ${mode}`);
	template.command = true;
	template.templatePath = await seedVaultFile(
		obsidian,
		sandbox,
		"call-template.md",
		`client: {{FIELD:client|${scope}|label:Which client?}}\nbackup: {{FIELD:client|${scope}|label:Backup client}}\n`,
	);
	template.fileNameFormat = { enabled: true, format: `call ${mode}` };
	template.folder = { ...template.folder, enabled: true, folders: [sandbox.path("out")] };
	await plugin.data<QuickAddData>().patch((data) => {
		data.onePageInputEnabled = onePage;
		data.choices.push(template);
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.exec("command", { id: `quickadd:choice:${template.id}` });
	return scope;
}

async function pick(selector: string, typed: string, expected: string) {
	const { obsidian } = getContext();
	await waitForElement(obsidian, selector);
	await typeInto(obsidian, selector, typed);
	await expect.poll(() => obsidian.dev.evalJson<string>(
		'document.querySelector(".suggestion-container .suggestion-item, .prompt .suggestion-item")?.textContent ?? ""',
	), POLL_OPTS).toBe(expected);
	await pressKey(obsidian, "Enter");
}

async function expectCallNote(mode: string) {
	const { obsidian, sandbox } = getContext();
	await expectNoPrompt(obsidian);
	await expect.poll(() => sandbox.read(`out/call ${mode}.md`).catch(() => ""), POLL_OPTS)
		.toBe("client: Globex\nbackup: Northwind\n");
	expect(await obsidian.dev.evalJson<string[]>(
		'Array.from(document.querySelectorAll(".notice")).map((notice) => notice.textContent)',
	)).not.toContainEqual(expect.stringContaining("Unknown FIELD filter"));
}

describe("FIELD |label:", () => {
	it("words each sequential prompt with its label", async () => {
		await runCallTemplate(false);
		await pick('.prompt input[placeholder="Which client?"]', "glo", "Globex");
		await pick('.prompt input[placeholder="Backup client"]', "nor", "Northwind");
		await expectCallNote("prompts");
	});

	it("names each one-page field after its label", async () => {
		const { obsidian } = getContext();
		const scope = await runCallTemplate(true);
		await waitForElement(obsidian, ".onePageInputModal");
		expect(await obsidian.dev.evalJson<string[]>(
			'Array.from(document.querySelectorAll(".onePageInputModal .setting-item-name")).map((name) => name.textContent)',
		)).toEqual(["Which client?", "Backup client"]);

		const field = (label: string) =>
			`.onePageInputModal input[aria-labelledby=${JSON.stringify(
				`qa-onepage-label-${encodeURIComponent(`FIELD:client|${scope}|label:${label}`)}`,
			)}]`;
		await pick(field("Which client?"), "glo", "Globex");
		await pick(field("Backup client"), "nor", "Northwind");
		await pressKey(obsidian, "Enter", true);
		await expectCallNote("form");
	});
});
