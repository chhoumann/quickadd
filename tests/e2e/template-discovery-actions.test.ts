import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ObsidianClient } from "obsidian-e2e";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { NestedChoiceCommand } from "../../src/types/macros/QuickCommands/NestedChoiceCommand";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";

const getContext = createQuickAddE2EHarness("template-discovery-actions");
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };
const POLL_OPTS = { timeout: 10_000, interval: 200 };
const INITIAL_CONTENT = "---\nstatus: active\n---\n# Existing note\n";
const VALUE_INPUT = '.qaInputPrompt input[type="text"], .qaInputPrompt textarea';

type QuickAddData = {
	choices: IChoice[];
	onePageInputEnabled: boolean;
};

async function waitForElement(obsidian: ObsidianClient, selector: string) {
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`Boolean(document.querySelector(${JSON.stringify(selector)})?.getClientRects().length)`,
	), POLL_OPTS).toBe(true);
}

async function typeInto(obsidian: ObsidianClient, selector: string, text: string) {
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const input = document.querySelector(${JSON.stringify(selector)});
		if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
		input.focus();
		input.select();
		return true;
	})()`)).toBe(true);
	await obsidian.exec("dev:cdp", {
		method: "Input.insertText",
		params: JSON.stringify({ text }),
	});
}

async function pressKey(obsidian: ObsidianClient, key: "Enter" | "Escape", modified = false) {
	const modifiers = modified
		? (await obsidian.dev.evalJson<string>("process.platform")) === "darwin" ? 4 : 2
		: 0;
	for (const type of ["keyDown", "keyUp"]) {
		await obsidian.exec("dev:cdp", {
			method: "Input.dispatchKeyEvent",
			params: JSON.stringify({ type, key, code: key, windowsVirtualKeyCode: key === "Enter" ? 13 : 27, modifiers }),
		});
	}
}

async function expectNoPrompt(obsidian: ObsidianClient) {
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		'Boolean(document.querySelector(".modal-container, .prompt"))',
	), POLL_OPTS).toBe(false);
}

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

function formField(id: string) {
	return `.onePageInputModal [aria-labelledby=${JSON.stringify(`qa-onepage-label-${id}`)}]`;
}

async function seedTemplate(name: string, options: {
	action?: TemplateChoice["existingNoteAction"];
	body?: string;
	folder?: string;
} = {}) {
	const { obsidian, sandbox } = getContext();
	const noteName = `Existing ${name}`;
	const relativePath = `${name}/original/${noteName}.md`;
	const targetPath = await seedVaultFile(obsidian, sandbox, relativePath, INITIAL_CONTENT);
	const template = new TemplateChoice(`Discover ${name}`);
	template.command = true;
	template.discoverExistingNotesBeforeCreate = true;
	template.existingNoteAction = options.action;
	template.templatePath = await seedVaultFile(
		obsidian, sandbox, `${name}/template.md`, options.body ?? "Owner: {{VALUE:owner}}\n",
	);
	template.fileNameFormat = { enabled: true, format: "{{VALUE}}" };
	template.folder = {
		...template.folder,
		enabled: true,
		folders: [sandbox.path(`${name}/new/${options.folder ?? "{{VALUE:creationFolder}}"}`)],
	};
	template.fileExistsBehavior = { kind: "apply", mode: "overwrite" };
	template.openFile = true;
	return { obsidian, sandbox, template, noteName, relativePath, targetPath, name };
}

async function runChoice(choice: IChoice, onePage: boolean) {
	const { obsidian, plugin } = getContext();
	await plugin.data<QuickAddData>().patch((data) => {
		data.onePageInputEnabled = onePage;
		data.choices.push(choice);
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });
}

async function chooseExisting(workflow: Awaited<ReturnType<typeof seedTemplate>>, onePage: boolean, verb?: string) {
	const { obsidian, template, noteName, targetPath } = workflow;
	const input = onePage
		? `[aria-label=${JSON.stringify(`Note for ${template.name}`)}]`
		: `input[placeholder=${JSON.stringify(`Search notes or create ${template.name}`)}]`;
	await waitForElement(obsidian, input);
	await typeInto(obsidian, input, noteName);
	if (onePage) {
		await expect.poll(() => obsidian.dev.evalJson<string>(
			'document.querySelector(".qa-onepage-file-suggestion__path")?.textContent ?? ""',
		), POLL_OPTS).toBe(targetPath);
	} else {
		await expect.poll(() => obsidian.dev.evalJson<string>(
			'document.querySelector(".suggestion-item .suggestion-title")?.textContent ?? ""',
		), POLL_OPTS).toContain(verb ? `${verb}: ${noteName}` : noteName);
	}
	await pressKey(obsidian, "Enter");
}

async function notePaths(workflow: Awaited<ReturnType<typeof seedTemplate>>) {
	return workflow.obsidian.dev.evalJson<string[]>(`app.vault.getFiles()
		.filter((file) => file.path.startsWith(${JSON.stringify(`${workflow.sandbox.path(workflow.name)}/`)}))
		.map((file) => file.path).sort()`);
}

describe("Template actions for discovered existing notes", () => {
	it.each([
		{ action: "appendBottom", verb: "Append to", expected: `${INITIAL_CONTENT}\nOwner: Ada\n` },
		{ action: "appendTop", verb: "Insert into", expected: "---\nstatus: active\n---\nOwner: Ada\n\n# Existing note\n" },
		{ action: "overwrite", verb: "Replace", expected: "Owner: Ada\n" },
	] satisfies Array<{ action: TemplateChoice["existingNoteAction"]; verb: string; expected: string }>)
	("persists $action and updates the selected path without asking where to create", async (scenario) => {
		const workflow = await seedTemplate(`action-${scenario.action}`, { action: scenario.action });
		const pathsBefore = await notePaths(workflow);
		await runChoice(workflow.template, false);
		await chooseExisting(workflow, false, scenario.verb);
		await waitForElement(workflow.obsidian, VALUE_INPUT);
		expect(await workflow.obsidian.dev.evalJson<string>(
			'document.querySelector(".qaInputPrompt")?.textContent ?? ""',
		)).toContain("owner");
		expect(await workflow.sandbox.read(workflow.relativePath)).toBe(INITIAL_CONTENT);
		await typeInto(workflow.obsidian, VALUE_INPUT, "Ada");
		await pressKey(workflow.obsidian, "Enter");
		const content = await workflow.sandbox.waitForContent(workflow.relativePath, (text) => text.includes("Owner: Ada"), WAIT_OPTS);
		expect(content).toBe(scenario.expected);
		await expectNoPrompt(workflow.obsidian);
		expect(await workflow.obsidian.dev.evalJson<string | null>("app.workspace.getActiveFile()?.path ?? null"))
			.toBe(workflow.targetPath);
		expect(await notePaths(workflow)).toEqual(pathsBefore);
	});

	it("cancels replacement at a template question without changing or creating a note", async () => {
		const workflow = await seedTemplate("cancel-replacement", { action: "overwrite" });
		const pathsBefore = await notePaths(workflow);
		await runChoice(workflow.template, false);
		await chooseExisting(workflow, false, "Replace");
		await waitForElement(workflow.obsidian, VALUE_INPUT);
		await typeInto(workflow.obsidian, VALUE_INPUT, "Unsubmitted owner");
		await pressKey(workflow.obsidian, "Escape");
		await expectNoPrompt(workflow.obsidian);
		expect(await workflow.sandbox.read(workflow.relativePath)).toBe(INITIAL_CONTENT);
		expect(await notePaths(workflow)).toEqual(pathsBefore);
	});

	it("makes a shared folder and body field optional when switching from creation to an existing note", async () => {
		const workflow = await seedTemplate("optional-shared-field", {
			action: "appendBottom",
			body: "Description: {{VALUE:detail|optional}}\n",
			folder: "{{VALUE:detail}}",
		});
		const pathsBefore = await notePaths(workflow);
		await runChoice(workflow.template, true);
		const noteInput = `[aria-label=${JSON.stringify(`Note for ${workflow.template.name}`)}]`;
		await waitForElement(workflow.obsidian, noteInput);
		await typeInto(workflow.obsidian, noteInput, "New optionality test note");
			await expect.poll(() => workflow.obsidian.dev.evalJson<string>(
				'document.querySelector(".qa-onepage-file-suggestion__label")?.textContent ?? ""',
			), POLL_OPTS).toBe("Create new note: New optionality test note");
		await pressKey(workflow.obsidian, "Enter");
		await waitForElement(workflow.obsidian, formField("detail"));
		const hasOptionalBadge = () => workflow.obsidian.dev.evalJson<boolean>(
			`Boolean(document.querySelector(${JSON.stringify(formField("detail"))})?.closest(".setting-item")?.querySelector(".qa-onepage-optional-badge"))`,
		);
		expect(await hasOptionalBadge()).toBe(false);
		expect(await workflow.obsidian.dev.evalJson<boolean>(`(() => {
			const button = document.querySelector('[aria-label="Change note"]');
			if (!button) return false;
			button.click();
			return true;
		})()`)).toBe(true);
		await chooseExisting(workflow, true);
		await expect.poll(hasOptionalBadge, POLL_OPTS).toBe(true);
		expect(await workflow.obsidian.dev.evalJson<string>(
			`document.querySelector(${JSON.stringify(formField("detail"))})?.value ?? "missing"`,
		)).toBe("");
		await pressKey(workflow.obsidian, "Enter", true);
		const content = await workflow.sandbox.waitForContent(workflow.relativePath, (text) => text.includes("Description:"), WAIT_OPTS);
		expect(content.trimEnd()).toBe(`${INITIAL_CONTENT}\nDescription:`);
		await expectNoPrompt(workflow.obsidian);
		expect(await notePaths(workflow)).toEqual(pathsBefore);
	});

	it("submits one combined form, applies the template once, and continues Capture with its own value", async () => {
		const workflow = await seedTemplate("macro-append", { action: "appendBottom" });
		const capture = new CaptureChoice("Capture after applying template");
		capture.captureToActiveFile = true;
		capture.activeFileWritePosition = "bottom";
		capture.useSelectionAsCaptureValue = false;
		capture.format = { enabled: true, format: "{{VALUE}} ({{VALUE:owner}})" };
		const captureCommand = new NestedChoiceCommand(capture);
		const macro = new MacroChoice("Apply discovered template then capture");
		macro.command = true;
		macro.macro.commands = [new NestedChoiceCommand(workflow.template), captureCommand];
		await runChoice(macro, true);
		await chooseExisting(workflow, true);
		await waitForElement(workflow.obsidian, formField("owner"));
		expect(await workflow.obsidian.dev.evalJson<boolean>(
			`Boolean(document.querySelector(${JSON.stringify(formField("creationFolder"))})?.getClientRects().length)`,
		)).toBe(false);
		await typeInto(workflow.obsidian, formField("owner"), "Ada");
		await typeInto(workflow.obsidian, formField(`__qa.value.${captureCommand.id}`), "Follow-up");
		expect(await workflow.sandbox.read(workflow.relativePath)).toBe(INITIAL_CONTENT);
		await pressKey(workflow.obsidian, "Enter", true);
		const content = await workflow.sandbox.waitForContent(workflow.relativePath, (text) => text.includes("Follow-up (Ada)"), WAIT_OPTS);
		expect(content.trimEnd()).toBe(`${INITIAL_CONTENT}\nOwner: Ada\n\nFollow-up (Ada)`);
		await expectNoPrompt(workflow.obsidian);
		expect(await workflow.obsidian.dev.evalJson<string | null>("app.workspace.getActiveFile()?.path ?? null"))
			.toBe(workflow.targetPath);
	});

	it("keeps the released open-only default even when the collision policy replaces files", async () => {
		const workflow = await seedTemplate("default-open");
		const pathsBefore = await notePaths(workflow);
		await runChoice(workflow.template, true);
		await chooseExisting(workflow, true);
		expect(await workflow.obsidian.dev.evalJson<boolean>(
			`Boolean(document.querySelector(${JSON.stringify(formField("owner"))})?.getClientRects().length)`,
		)).toBe(false);
		await pressKey(workflow.obsidian, "Enter", true);
		await expectNoPrompt(workflow.obsidian);
		await expect.poll(() => workflow.obsidian.dev.evalJson<string | null>(
			"app.workspace.getActiveFile()?.path ?? null",
		), POLL_OPTS).toBe(workflow.targetPath);
		expect(await workflow.sandbox.read(workflow.relativePath)).toBe(INITIAL_CONTENT);
		expect(await notePaths(workflow)).toEqual(pathsBefore);
	});

	it("does not interpret custom text as a reserved selection that replaces a canvas", async () => {
		const workflow = await seedTemplate("reserved-selection", {
			action: "overwrite", body: "THIS MUST NOT REPLACE THE CANVAS\n", folder: "created",
		});
		const canvasRelativePath = `${workflow.name}/Protected.canvas`;
		const canvasContent = JSON.stringify({ nodes: [], edges: [] });
		const canvasPath = await seedVaultFile(workflow.obsidian, workflow.sandbox, canvasRelativePath, canvasContent);
		await runChoice(workflow.template, false);
		const input = `input[placeholder=${JSON.stringify(`Search notes or create ${workflow.template.name}`)}]`;
		await waitForElement(workflow.obsidian, input);
		await typeInto(workflow.obsidian, input, `@quickadd-existing-note:${canvasPath}`);
		await pressKey(workflow.obsidian, "Enter");
		await expectNoPrompt(workflow.obsidian);
		await expect.poll(() => workflow.obsidian.dev.evalJson<string>(
			'Array.from(document.querySelectorAll(".notice"), (notice) => notice.textContent).join("\\n")',
		), POLL_OPTS).toMatch(/cannot create|cannot contain|Markdown note/i);
		expect(await workflow.sandbox.read(canvasRelativePath)).toBe(canvasContent);
		expect(await workflow.sandbox.read(workflow.relativePath)).toBe(INITIAL_CONTENT);
	});
});
