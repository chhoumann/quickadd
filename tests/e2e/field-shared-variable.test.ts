import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type IChoice from "../../src/types/choices/IChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { NestedChoiceCommand } from "../../src/types/macros/QuickCommands/NestedChoiceCommand";
import { UserScript } from "../../src/types/macros/UserScript";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, closeOpenPrompts, expectNoPrompt, pressKey, typeInto, waitForElement } from "./uiHelpers";

// #2289: `{{FIELD:<property>|name:<variable>}}` reads and writes a run variable,
// the way `{{VALUE:<variable>}}` does. Without `|name:` a FIELD keeps to itself.
const getContext = createQuickAddE2EHarness("field-shared-variable");

type QuickAddData = {
	choices: IChoice[];
	onePageInputEnabled: boolean;
};

const FIELD_PICKER = ".prompt input";

beforeEach(() => closeOpenPrompts(getContext().obsidian));
afterEach(() => closeOpenPrompts(getContext().obsidian));

async function templateChoice(name: string, body: string): Promise<TemplateChoice> {
	const { obsidian, sandbox } = getContext();
	// The reporter's note: a property `test` whose value the picker would offer.
	await seedVaultFile(obsidian, sandbox, "Notes/has-test.md", "---\ntest: value\n---\n");
	const template = new TemplateChoice(name);
	template.command = true;
	template.templatePath = await seedVaultFile(obsidian, sandbox, `${name}.template.md`, body);
	template.fileNameFormat = { enabled: true, format: name };
	template.folder = { ...template.folder, enabled: true, folders: [sandbox.path("out")] };
	return template;
}

async function install(choices: IChoice[], onePage = false) {
	const { plugin } = getContext();
	await plugin.data<QuickAddData>().patch((data) => {
		data.onePageInputEnabled = onePage;
		data.choices.push(...choices);
	});
	await plugin.reload({ waitUntilReady: true });
}

async function expectNote(name: string, content: string) {
	const { sandbox } = getContext();
	await expect.poll(() => sandbox.read(`out/${name}.md`).catch(() => ""), POLL_OPTS).toBe(content);
}

const NAMED_TEMPLATE = "---\ntest: {{FIELD:test|name:test}}\n---\nbody {{FIELD:test|name:test}}\n";
const UNNAMED_TEMPLATE = "---\ntest: {{FIELD:test}}\n---\nbody {{FIELD:test}}\n";

/** A macro whose script sets the run variable `test` before it runs `template`. */
async function scriptThenTemplate(name: string, template: TemplateChoice): Promise<MacroChoice> {
	const { obsidian, sandbox } = getContext();
	template.command = false;
	const script = await seedVaultFile(obsidian, sandbox, "set-test.js",
		'module.exports = async (params) => { params.variables.test = "other"; };\n');
	const macro = new MacroChoice(name);
	macro.command = true;
	macro.macro.commands.push(new UserScript("set-test", script), new NestedChoiceCommand(template));
	return macro;
}

async function pickFromVault(selector: string, typed: string, expected: string) {
	const { obsidian } = getContext();
	await waitForElement(obsidian, selector);
	await typeInto(obsidian, selector, typed);
	await expect.poll(() => obsidian.dev.evalJson<string>(
		'document.querySelector(".suggestion-container .suggestion-item, .prompt .suggestion-item")?.textContent ?? ""',
	), POLL_OPTS).toBe(expected);
	await pressKey(obsidian, "Enter");
}

const formFieldNames = () => getContext().obsidian.dev.evalJson<string[]>(
	'Array.from(document.querySelectorAll(".onePageInputModal .setting-item-name")).map((name) => name.textContent)',
);

describe("FIELD |name:", () => {
	it("does not ask when an earlier macro script set the variable", async () => {
		const { obsidian } = getContext();
		const macro = await scriptThenTemplate("Script then template", await templateChoice("from script", NAMED_TEMPLATE));
		await install([macro]);

		await obsidian.exec("command", { id: `quickadd:choice:${macro.id}` });

		await expectNote("from script", "---\ntest: other\n---\nbody other\n");
		await expectNoPrompt(obsidian);
	});

	it("takes the value from a non-interactive CLI run", async () => {
		const { obsidian } = getContext();
		const template = await templateChoice("from cli", NAMED_TEMPLATE);
		await install([template]);

		const outcome = await obsidian.execJson<{ ok: boolean; missingFlags?: string[] }>(
			"quickadd:run", { id: template.id, "value-test": "other" });

		expect(outcome).toMatchObject({ ok: true });
		await expectNote("from cli", "---\ntest: other\n---\nbody other\n");
	});

	it("leaves the field out of the one-page form when the API supplied it", async () => {
		const { obsidian } = getContext();
		const template = await templateChoice("from api", "---\ntest: {{FIELD:test|name:test}}\n---\n{{VALUE:extra}}\n");
		await install([template], true);

		await obsidian.dev.evalJson(
			'void app.plugins.plugins.quickadd.api.executeChoice("from api", { test: "other" })');

		await waitForElement(obsidian, ".onePageInputModal");
		expect(await formFieldNames()).toEqual(["extra"]);
		await typeInto(obsidian, ".onePageInputModal input", "more");
		await pressKey(obsidian, "Enter", true);
		await expectNote("from api", "---\ntest: other\n---\nmore\n");
		await expectNoPrompt(obsidian);
	});

	it("shares its pick with a later {{VALUE}} of that name", async () => {
		const { obsidian } = getContext();
		const template = await templateChoice("pick shared", "value: {{VALUE:test}}\nfield: {{FIELD:test|name:test}}\n");
		await install([template]);

		await obsidian.exec("command", { id: `quickadd:choice:${template.id}` });

		await pickFromVault(FIELD_PICKER, "valu", "value");
		await expectNote("pick shared", "value: value\nfield: value\n");
		await expectNoPrompt(obsidian);
	});

	it("asks once in the one-page form, with the vault's values, for a VALUE and a FIELD sharing a name", async () => {
		const { obsidian } = getContext();
		const template = await templateChoice("asked once", "value: {{VALUE:test}}\nfield: {{FIELD:test|name:test}}\n");
		await install([template], true);

		await obsidian.exec("command", { id: `quickadd:choice:${template.id}` });

		await waitForElement(obsidian, ".onePageInputModal");
		expect(await formFieldNames()).toEqual(["test"]);
		await pickFromVault(".onePageInputModal input", "valu", "value");
		await pressKey(obsidian, "Enter", true);
		await expectNote("asked once", "value: value\nfield: value\n");
		await expectNoPrompt(obsidian);
	});

	it("still asks a FIELD without |name: when a script set a variable of its name", async () => {
		const { obsidian } = getContext();
		const macro = await scriptThenTemplate("Script then unnamed", await templateChoice("unnamed", UNNAMED_TEMPLATE));
		await install([macro]);

		await obsidian.exec("command", { id: `quickadd:choice:${macro.id}` });

		await pickFromVault(FIELD_PICKER, "valu", "value");
		await expectNote("unnamed", "---\ntest: value\n---\nbody value\n");
		await expectNoPrompt(obsidian);
	});

	it("still asks for {{FIELD:title}}, which the note's own title does not answer", async () => {
		const { obsidian, sandbox } = getContext();
		await seedVaultFile(obsidian, sandbox, "Notes/has-title.md", "---\ntitle: Front matter title\n---\n");
		const template = await templateChoice("titled", "---\ntitle: {{FIELD:title}}\n---\n# {{TITLE}}\n");
		await install([template]);

		await obsidian.exec("command", { id: `quickadd:choice:${template.id}` });

		await pickFromVault(FIELD_PICKER, "Front matter", "Front matter title");
		await expectNote("titled", "---\ntitle: Front matter title\n---\n# titled\n");
		await expectNoPrompt(obsidian);
	});
});
