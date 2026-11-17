import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { NestedChoiceCommand } from "../../src/types/macros/QuickCommands/NestedChoiceCommand";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";
import { POLL_OPTS, closeOpenPrompts, expectNoPrompt, insertText, jsLiteral, pressKey, typeInto, waitForElement } from "./uiHelpers";

// #2287: a run that did not start in ChoiceExecutor.execute() - applying a
// template to a note, a macro run at startup - asked one prompt at a time with
// the one-page form on.
const getContext = createQuickAddE2EHarness("apply-template-one-page");

type QuickAddData = {
	choices: IChoice[];
	onePageInputEnabled: boolean;
	templateFolderPaths: string[];
};

const TEMPLATE = "First: {{VALUE:test1}}\nSecond: {{VALUE:test2}}\n";

beforeEach(() => closeOpenPrompts(getContext().obsidian));
afterEach(() => closeOpenPrompts(getContext().obsidian));

/** The title and field names of the prompt on top, which tell the one-page form from a single prompt. */
async function topPrompt() {
	const { obsidian } = getContext();
	await waitForElement(obsidian, ".modal-container .modal");
	return obsidian.dev.evalJson<{ title: string; fields: string[] }>(`(() => {
		const modal = [...document.querySelectorAll(".modal-container .modal")].at(-1);
		return {
			title: modal.querySelector("h2")?.textContent || modal.querySelector(".modal-title")?.textContent || "",
			fields: [...modal.querySelectorAll(".setting-item")]
				.filter((field) => field.querySelector("input, textarea"))
				.map((field) => field.querySelector(".setting-item-name")?.textContent ?? ""),
		};
	})()`);
}

async function fillForm(answers: string[]) {
	const { obsidian } = getContext();
	for (const [index, text] of answers.entries()) {
		expect(await obsidian.dev.evalJson<boolean>(`(() => {
			const fields = [...document.querySelectorAll(".modal-container .setting-item")].filter((field) => field.querySelector("input, textarea"));
			const input = fields[${index}]?.querySelector("input, textarea");
			input?.focus();
			return Boolean(input);
		})()`)).toBe(true);
		await insertText(obsidian, text);
	}
	await pressKey(obsidian, "Enter", true);
}

/** Runs the command on `note` and picks the template row labelled `label`. */
async function applyTemplate(note: string, label: string) {
	const { obsidian } = getContext();
	await obsidian.dev.evalJsonAsync(`(async () => {
		const leaf = app.workspace.getLeaf(false);
		await leaf.openFile(app.vault.getAbstractFileByPath(${jsLiteral(note)}));
		app.workspace.setActiveLeaf(leaf, { focus: true });
		return true;
	})()`);
	await obsidian.exec("command", { id: "quickadd:applyTemplateToActiveFile" });
	await waitForElement(obsidian, ".prompt input");
	await typeInto(obsidian, ".prompt input", label);
	await expect.poll(() => obsidian.dev.evalJson<string[]>(
		'Array.from(document.querySelectorAll(".prompt .suggestion-item"), (item) => item.textContent)',
	), POLL_OPTS).toEqual([label]);
	await pressKey(obsidian, "Enter");
}

describe("apply template to note with the one-page form", () => {
	it("asks for a template file's inputs in one form (#2287)", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "templates/two-inputs.md", TEMPLATE);
		const note = await seedVaultFile(obsidian, sandbox, "new-note.md", "");
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = true;
			data.templateFolderPaths = [sandbox.path("templates")];
		});
		await plugin.reload({ waitUntilReady: true });

		await applyTemplate(note, `Template: ${template}`);

		expect(await topPrompt()).toEqual({ title: "Provide inputs", fields: ["test1", "test2"] });
		await fillForm(["alpha", "beta"]);
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("new-note.md"), POLL_OPTS)
			.toBe("First: alpha\nSecond: beta\n");
	});

	it("asks one prompt at a time with the form off", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const template = await seedVaultFile(obsidian, sandbox, "templates/two-inputs.md", TEMPLATE);
		const note = await seedVaultFile(obsidian, sandbox, "new-note.md", "");
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = false;
			data.templateFolderPaths = [sandbox.path("templates")];
		});
		await plugin.reload({ waitUntilReady: true });

		await applyTemplate(note, `Template: ${template}`);

		expect(await topPrompt()).toEqual({ title: "test1", fields: [] });
		await insertText(obsidian, "alpha");
		await pressKey(obsidian, "Enter");
		await expect.poll(async () => (await topPrompt()).title, POLL_OPTS).toBe("test2");
		await insertText(obsidian, "beta");
		await pressKey(obsidian, "Enter");
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("new-note.md"), POLL_OPTS)
			.toBe("First: alpha\nSecond: beta\n");
	});

	it.each([
		{ override: "always", global: false, form: true },
		{ override: "never", global: true, form: false },
	] as const)("follows a Template choice's override: $override", async ({ override, global, form }) => {
		const { obsidian, plugin, sandbox } = getContext();
		const note = await seedVaultFile(obsidian, sandbox, "new-note.md", "");
		const choice = new TemplateChoice(`Two inputs ${override}`);
		choice.templatePath = await seedVaultFile(obsidian, sandbox, "choice-template.md", TEMPLATE);
		choice.onePageInput = override;
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = global;
			data.choices.push(choice);
		});
		await plugin.reload({ waitUntilReady: true });

		await applyTemplate(note, `Choice: ${choice.name}`);

		expect(await topPrompt()).toEqual(form
			? { title: "Provide inputs", fields: ["test1", "test2"] }
			: { title: "test1", fields: [] });
	});

	it("writes {{DATE}} for the picked choice's Which day", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const note = await seedVaultFile(obsidian, sandbox, "new-note.md", "");
		const choice = new TemplateChoice("Next year's plan");
		choice.templatePath = await seedVaultFile(obsidian, sandbox, "plan-template.md", "Plan for {{DATE:YYYY}}\n");
		choice.dateOrigin = { kind: "relative", offset: 1, unit: "years" };
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = false;
			data.choices.push(choice);
		});
		await plugin.reload({ waitUntilReady: true });

		await applyTemplate(note, `Choice: ${choice.name}`);

		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("new-note.md"), POLL_OPTS)
			.toBe(`Plan for ${new Date().getFullYear() + 1}\n`);
	});

	it("asks for the inputs of the choice's file name too, then offers the move", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const note = await seedVaultFile(obsidian, sandbox, "new-note.md", "");
		const choice = new TemplateChoice("Client meeting");
		choice.templatePath = await seedVaultFile(obsidian, sandbox, "meeting-template.md", "Topic: {{VALUE:topic}}\n");
		choice.fileNameFormat = { enabled: true, format: "{{VALUE:client}} meeting" };
		choice.folder = { ...choice.folder, enabled: true, folders: [sandbox.path("meetings")] };
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = true;
			data.choices.push(choice);
		});
		await plugin.reload({ waitUntilReady: true });

		await applyTemplate(note, `Choice: ${choice.name}`);

		expect((await topPrompt()).fields).toEqual(["client", "topic"]);
		await fillForm(["Acme", "Roadmap"]);
		// The next thing on screen is the move offer, not a prompt for `client`.
		await expect.poll(async () => (await topPrompt()).title, POLL_OPTS)
			.toBe("Move note to match choice settings?");
		await pressKey(obsidian, "Enter");
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("meetings/Acme meeting.md").catch(() => ""), POLL_OPTS)
			.toBe("Topic: Roadmap\n");
	});
});

describe("a macro run at startup with the one-page form", () => {
	it("asks for its Captures' inputs in one form, not one form per step", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const captures = [["mood", "Startup mood"], ["focus", "Startup focus"]].map(([input, name]) => {
			const capture = new CaptureChoice(name);
			capture.captureTo = sandbox.path("startup-log.md");
			capture.createFileIfItDoesntExist = { ...capture.createFileIfItDoesntExist, enabled: true };
			capture.format = { enabled: true, format: `${input}: {{VALUE:${input}}}\n` };
			return capture;
		});
		const macro = new MacroChoice("Startup check-in");
		macro.runOnStartup = true;
		macro.macro.commands.push(...captures.map((capture) => new NestedChoiceCommand(capture)));
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = true;
			data.choices.push(macro);
		});
		// Loading the plugin is what runs the macro.
		await plugin.reload({ waitUntilReady: true });

		expect(await topPrompt()).toEqual({ title: "Provide inputs", fields: ["mood", "focus"] });
		await fillForm(["calm", "writing"]);
		await expectNoPrompt(obsidian);
		await expect.poll(() => sandbox.read("startup-log.md").catch(() => ""), POLL_OPTS)
			.toBe("focus: writing\nmood: calm\n");
	});
});
