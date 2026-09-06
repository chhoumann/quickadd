import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ObsidianClient } from "obsidian-e2e";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import { NestedChoiceCommand } from "../../src/types/macros/QuickCommands/NestedChoiceCommand";
import type IChoice from "../../src/types/choices/IChoice";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";

const getContext = createQuickAddE2EHarness("macro-one-page-discovery");
const WAIT_OPTS = { timeoutMs: 10_000, intervalMs: 200 };

type QuickAddData = {
	choices: IChoice[];
	onePageInputEnabled: boolean;
};

async function waitForElement(obsidian: ObsidianClient, selector: string) {
	await expect.poll(
		() => obsidian.dev.evalJson<boolean>(
			`Boolean(document.querySelector(${JSON.stringify(selector)}))`,
		),
		{ timeout: 10_000, interval: 200 },
	).toBe(true);
}

async function typeInto(obsidian: ObsidianClient, selector: string, value: string) {
	const changed = await obsidian.dev.evalJson<boolean>(`(() => {
		const input = document.querySelector(${JSON.stringify(selector)});
		if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
		input.focus();
		input.value = ${JSON.stringify(value)};
		input.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	})()`);
	expect(changed).toBe(true);
}

async function closeOpenPrompts() {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson<boolean>(`(() => {
		for (const modal of Array.from(document.querySelectorAll(".modal-container")).reverse()) {
			const cancel = Array.from(modal.querySelectorAll("button")).find((button) => button.textContent.trim() === "Cancel");
			const close = cancel ?? modal.querySelector(".modal-close-button");
			close?.click();
		}
		return true;
	})()`);
	for (let remaining = 10; remaining > 0; remaining--) {
		if (!await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".modal-container"))')) break;
		for (const type of ["keyDown", "keyUp"]) {
			await obsidian.exec("dev:cdp", {
				method: "Input.dispatchKeyEvent",
				params: JSON.stringify({ type, key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }),
			});
		}
	}
	await expectNoPrompt(obsidian);
}

beforeEach(closeOpenPrompts);
afterEach(closeOpenPrompts);

describe("macro discovery and one-page input overrides", () => {
	it.each([
		{ name: "global", global: true, macro: undefined, capture: undefined, onePage: true },
		{ name: "always", global: false, macro: "always", capture: undefined, onePage: true },
		{ name: "never", global: true, macro: "never", capture: undefined, onePage: false },
		{ name: "step-never", global: false, macro: "always", capture: "never", onePage: false },
	] satisfies Array<{
		name: string;
		global: boolean;
		macro: IChoice["onePageInput"];
		capture: IChoice["onePageInput"];
		onePage: boolean;
	}>)("keeps discovery before Capture with $name settings", async (scenario) => {
		const { obsidian, plugin, sandbox } = getContext();
		const noteName = `Discovery target ${scenario.name}`;
		const relativePath = `${scenario.name}/${noteName}.md`;
		const initialContent = "# Existing note\n";
		const targetPath = await seedVaultFile(obsidian, sandbox, relativePath, initialContent);
		const templatePath = await seedVaultFile(
			obsidian, sandbox, `${scenario.name}/template.md`, "TEMPLATE MUST NOT REPLACE EXISTING NOTE\n",
		);
		const template = new TemplateChoice(`Discover ${scenario.name}`);
		template.templatePath = templatePath;
		template.onePageInput = "never";
		template.discoverExistingNotesBeforeCreate = true;
		template.fileNameFormat = { enabled: true, format: "{{VALUE}}" };
		template.folder = { ...template.folder, enabled: true, folders: [sandbox.path(scenario.name)] };
		template.openFile = true;
		const capture = new CaptureChoice(`Capture ${scenario.name}`);
		capture.onePageInput = scenario.capture;
		capture.captureToActiveFile = true;
		capture.activeFileWritePosition = "bottom";
		capture.useSelectionAsCaptureValue = false;
		capture.format = { enabled: true, format: "{{VALUE}}" };
		const macro = new MacroChoice(`Discovery macro ${scenario.name}`);
		macro.command = true;
		macro.onePageInput = scenario.macro;
		macro.macro.commands = [template, capture].map((choice) => new NestedChoiceCommand(choice));
		await plugin.data<QuickAddData>().patch((data) => {
			data.onePageInputEnabled = scenario.global;
			data.choices.push(macro);
		});
		await plugin.reload({ waitUntilReady: true });

		await obsidian.exec("command", { id: `quickadd:choice:${macro.id}` });
		const discoveryInput = 'input[placeholder="Search notes or create ' + template.name + '"]';
		await waitForElement(obsidian, discoveryInput);
		expect(await obsidian.dev.evalJson<boolean>(
			'Boolean(document.querySelector(".onePageInputModal"))',
		)).toBe(false);
		await typeInto(obsidian, discoveryInput, noteName);
		await expect.poll(
			() => obsidian.dev.evalJson<boolean>(`Array.from(document.querySelectorAll(".suggestion-item"))
				.some((item) => item.textContent.includes(${JSON.stringify(noteName)}))`),
			{ timeout: 10_000, interval: 200 },
		).toBe(true);
		expect(await obsidian.dev.evalJson<boolean>(`(() => {
			const item = Array.from(document.querySelectorAll(".suggestion-item"))
				.find((item) => item.textContent.includes(${JSON.stringify(noteName)}));
			if (!item) return false;
			item.click();
			return true;
		})()`)).toBe(true);

		const modal = scenario.onePage ? ".onePageInputModal" : ".qaInputPrompt";
		await waitForElement(obsidian, modal);
		expect(await sandbox.read(relativePath)).toBe(initialContent);
		expect(await obsidian.dev.evalJson<string | null>(
			"app.workspace.getActiveFile()?.path ?? null",
		)).toBe(targetPath);
		expect(await obsidian.dev.evalJson<boolean>(
			'Boolean(document.querySelector(".onePageInputModal"))',
		)).toBe(scenario.onePage);
		const answer = `CAPTURE ANSWER ${scenario.name}`;
		await typeInto(obsidian, `${modal} input[type="text"], ${modal} textarea`, answer);
		expect(await obsidian.dev.evalJson<boolean>(`(() => {
			const button = document.querySelector(${JSON.stringify(`${modal} button.mod-cta`)});
			if (!button) return false;
			button.click();
			return true;
		})()`)).toBe(true);
		const content = await sandbox.waitForContent(relativePath, (text) => text.includes(answer), WAIT_OPTS);
		expect(content.trimEnd()).toBe(`${initialContent}\n${answer}`);
		expect(await obsidian.dev.evalJson<boolean>(
			`Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(sandbox.path(`${scenario.name}/${answer}.md`))}))`,
		)).toBe(false);
		await expect.poll(
			() => obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".modal-container"))'),
			{ timeout: 10_000, interval: 200 },
		).toBe(false);
	});
});

async function seedCombinedWorkflow(name: string, options: {
	templateOverride?: "never";
	twoCaptures?: boolean;
	templateBody?: string;
} = {}) {
	const { obsidian, plugin, sandbox } = getContext();
	const noteName = `Existing ${name}`;
	const relativePath = `${name}/${noteName}.md`;
	await seedVaultFile(obsidian, sandbox, relativePath, "# Existing note\n");
	const template = new TemplateChoice(`Discover ${name}`);
	template.templatePath = await seedVaultFile(obsidian, sandbox, `${name}/template.md`, options.templateBody ?? "Owner: {{VALUE:owner}}\n");
	template.onePageInput = options.templateOverride;
	template.discoverExistingNotesBeforeCreate = true;
	template.fileNameFormat = { enabled: true, format: "{{VALUE}}" };
	template.folder = { ...template.folder, enabled: true, folders: [sandbox.path(name)] };
	template.openFile = true;
	const captures = Array.from({ length: options.twoCaptures ? 2 : 1 }, (_, index) => {
		const capture = new CaptureChoice(`Capture ${index + 1}`);
		capture.captureToActiveFile = true;
		capture.activeFileWritePosition = "bottom";
		capture.useSelectionAsCaptureValue = false;
		capture.format = { enabled: true, format: `{{VALUE}} {{VALUE:details${index || ""}}}` };
		return capture;
	});
	const macro = new MacroChoice(`Combined discovery ${name}`);
	macro.command = true;
	macro.macro.commands = [template, ...captures].map((choice) => new NestedChoiceCommand(choice));
	await plugin.data<QuickAddData>().patch((data) => {
		data.onePageInputEnabled = true;
		data.choices.push(macro);
	});
	await plugin.reload({ waitUntilReady: true });
	await obsidian.exec("command", { id: `quickadd:choice:${macro.id}` });
	return { obsidian, sandbox, template, macro, noteName, relativePath };
}

function formField(id: string): string {
	return `.onePageInputModal [aria-labelledby=${JSON.stringify(`qa-onepage-label-${id}`)}]`;
}

async function clickElement(obsidian: ObsidianClient, selector: string) {
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const element = document.querySelector(${JSON.stringify(selector)});
		if (!element) return false;
		element.click();
		return true;
	})()`)).toBe(true);
}

async function chooseSuggestion(obsidian: ObsidianClient, selector: string, text: string) {
	await expect.poll(() => obsidian.dev.evalJson<boolean>(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
		.some((item) => item.textContent.includes(${JSON.stringify(text)}))`), { timeout: 10_000, interval: 200 }).toBe(true);
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const item = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
			.find((item) => item.textContent.includes(${JSON.stringify(text)}));
		if (!item) return false;
		item.click();
		return true;
	})()`)).toBe(true);
}

async function expectOwnerVisible(obsidian: ObsidianClient, visible: boolean) {
	expect(await obsidian.dev.evalJson<boolean>(`Boolean(document.querySelector(${JSON.stringify(formField("owner"))})?.getClientRects().length)`)).toBe(visible);
}

async function expectNoPrompt(obsidian: ObsidianClient) {
	await expect.poll(() => obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".modal-container, .prompt"))'),
		{ timeout: 10_000, interval: 200 }).toBe(false);
}

describe("combined discovery form", () => {
	it("chooses an existing note and collects named and anonymous capture inputs in one form", async () => {
		const { obsidian, sandbox, template, macro, noteName, relativePath } = await seedCombinedWorkflow("combined-existing");
		const noteInput = `[aria-label=${JSON.stringify(`Note for ${template.name}`)}]`;
		await waitForElement(obsidian, noteInput);
		await expectOwnerVisible(obsidian, false);
		await typeInto(obsidian, noteInput, noteName);
		await chooseSuggestion(obsidian, ".qa-onepage-file-suggestion", noteName);
		await expectOwnerVisible(obsidian, false);
		await typeInto(obsidian, formField(`__qa.value.${macro.macro.commands[1].id}`), "First capture");
		await typeInto(obsidian, formField("details"), "Extra detail");
		await clickElement(obsidian, ".onePageInputModal button.mod-cta");
		const content = await sandbox.waitForContent(relativePath, (text) => text.includes("First capture Extra detail"), WAIT_OPTS);
		expect(content.trimEnd()).toBe("# Existing note\n\nFirst capture Extra detail");
		await expectNoPrompt(obsidian);
	});

	it("retains drafts when switching existing and new notes and creates with all answers", async () => {
		const { obsidian, sandbox, template, macro, noteName, relativePath } = await seedCombinedWorkflow("combined-create");
		const noteInput = `[aria-label=${JSON.stringify(`Note for ${template.name}`)}]`;
		const createdName = "Created through combined form";
		await waitForElement(obsidian, noteInput);
		await typeInto(obsidian, noteInput, createdName);
		await chooseSuggestion(obsidian, ".qa-onepage-file-suggestion", `Create new note: ${createdName}`);
		await expectOwnerVisible(obsidian, true);
		await typeInto(obsidian, formField("owner"), "Alice");
		await typeInto(obsidian, formField(`__qa.value.${macro.macro.commands[1].id}`), "Capture draft");
		await typeInto(obsidian, formField("details"), "Details draft");
		await clickElement(obsidian, '[aria-label="Change note"]');
		await typeInto(obsidian, noteInput, noteName);
		await chooseSuggestion(obsidian, ".qa-onepage-file-suggestion", noteName);
		await expectOwnerVisible(obsidian, false);
		await clickElement(obsidian, '[aria-label="Change note"]');
		await typeInto(obsidian, noteInput, createdName);
		await chooseSuggestion(obsidian, ".qa-onepage-file-suggestion", `Create new note: ${createdName}`);
		await expectOwnerVisible(obsidian, true);
		for (const [id, expected] of [["owner", "Alice"], ["details", "Details draft"], [`__qa.value.${macro.macro.commands[1].id}`, "Capture draft"]]) {
			expect(await obsidian.dev.evalJson<string>(`document.querySelector(${JSON.stringify(formField(id))}).value`)).toBe(expected);
		}
		await clickElement(obsidian, ".onePageInputModal button.mod-cta");
		const content = await sandbox.waitForContent(`combined-create/${createdName}.md`, (text) => text.includes("Capture draft Details draft"), WAIT_OPTS);
		expect(content.trimEnd()).toBe("Owner: Alice\n\nCapture draft Details draft");
		expect(await sandbox.read(relativePath)).toBe("# Existing note\n");
		await expectNoPrompt(obsidian);
	});

	it("follows an opted-out discovery picker with one form for two independent captures", async () => {
		const { obsidian, sandbox, template, macro, noteName, relativePath } = await seedCombinedWorkflow("grouped-after-picker", { templateOverride: "never", twoCaptures: true });
		const noteInput = `input[placeholder=${JSON.stringify(`Search notes or create ${template.name}`)}]`;
		await waitForElement(obsidian, noteInput);
		expect(await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".onePageInputModal"))')).toBe(false);
		await typeInto(obsidian, noteInput, noteName);
		await chooseSuggestion(obsidian, ".suggestion-item", noteName);
		await waitForElement(obsidian, ".onePageInputModal");
		await typeInto(obsidian, formField(`__qa.value.${macro.macro.commands[1].id}`), "First answer");
		await typeInto(obsidian, formField(`__qa.value.${macro.macro.commands[2].id}`), "Second answer");
		await typeInto(obsidian, formField("details"), "First details");
		await typeInto(obsidian, formField("details1"), "Second details");
		await clickElement(obsidian, ".onePageInputModal button.mod-cta");
		const content = await sandbox.waitForContent(relativePath, (text) => text.includes("Second answer Second details"), WAIT_OPTS);
		expect(content.trimEnd()).toBe("# Existing note\n\nFirst answer First details\nSecond answer Second details");
		await expectNoPrompt(obsidian);
	});
});

async function pressEnter(obsidian: ObsidianClient, modified = false) {
	const modifiers = modified
		? (await obsidian.dev.evalJson<string>("process.platform")) === "darwin" ? 4 : 2
		: 0;
	for (const type of ["keyDown", "keyUp"]) {
		await obsidian.exec("dev:cdp", {
			method: "Input.dispatchKeyEvent",
			params: JSON.stringify({ type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, modifiers }),
		});
	}
}

async function fillKeyboardCapture(workflow: Awaited<ReturnType<typeof seedCombinedWorkflow>>) {
	await typeInto(workflow.obsidian, formField(`__qa.value.${workflow.macro.macro.commands[1].id}`), "Keyboard capture");
	await typeInto(workflow.obsidian, formField("details"), "Keyboard details");
}

async function typeFuzzyNewTitle(workflow: Awaited<ReturnType<typeof seedCombinedWorkflow>>) {
	const input = `[aria-label=${JSON.stringify(`Note for ${workflow.template.name}`)}]`;
	const title = workflow.noteName.slice(0, -2);
	await typeInto(workflow.obsidian, input, title);
	await expect.poll(() => workflow.obsidian.dev.evalJson<string[]>(
		'Array.from(document.querySelectorAll(".qa-onepage-file-suggestion__label"), (item) => item.textContent)',
	), { timeout: 10_000, interval: 200 }).toEqual(expect.arrayContaining([workflow.noteName, `Create new note: ${title}`]));
	return title;
}

async function waitForExactSuggestion(workflow: Awaited<ReturnType<typeof seedCombinedWorkflow>>) {
	await expect.poll(() => workflow.obsidian.dev.evalJson<string[]>(
		'Array.from(document.querySelectorAll(".qa-onepage-file-suggestion__label"), (item) => item.textContent)',
	), { timeout: 10_000, interval: 200 }).toContain(workflow.noteName);
}

async function expectKeyboardCreated(workflow: Awaited<ReturnType<typeof seedCombinedWorkflow>>, title: string, firstLine: string) {
	const folder = workflow.relativePath.slice(0, workflow.relativePath.lastIndexOf("/"));
	const content = await workflow.sandbox.waitForContent(`${folder}/${title}.md`, (text) => text.includes("Keyboard capture Keyboard details"), WAIT_OPTS);
	expect(content.trimEnd()).toBe(`${firstLine}\n\nKeyboard capture Keyboard details`);
	expect(await workflow.sandbox.read(workflow.relativePath)).toBe("# Existing note\n");
	await expectNoPrompt(workflow.obsidian);
}

describe("discovery keyboard submission", () => {
	it("Enter creates the typed prefix instead of choosing a fuzzy existing match", async () => {
		const workflow = await seedCombinedWorkflow("keyboard-enter");
		await waitForElement(workflow.obsidian, ".onePageInputModal");
		await fillKeyboardCapture(workflow);
		const title = await typeFuzzyNewTitle(workflow);
		await pressEnter(workflow.obsidian);
		expect(await workflow.obsidian.dev.evalJson<string>(
			'document.querySelector(".qa-onepage-file-picker__chip-label")?.textContent ?? ""',
		)).toBe(`Create: ${title}`);
		await expectOwnerVisible(workflow.obsidian, true);
		await typeInto(workflow.obsidian, formField("owner"), "Keyboard owner");
		await pressEnter(workflow.obsidian, true);
		await expectKeyboardCreated(workflow, title, "Owner: Keyboard owner");
	});

	it("Mod+Enter resolves a pending title and waits for newly revealed template questions", async () => {
		const workflow = await seedCombinedWorkflow("keyboard-mod-enter");
		await waitForElement(workflow.obsidian, ".onePageInputModal");
		await fillKeyboardCapture(workflow);
		const title = await typeFuzzyNewTitle(workflow);
		await pressEnter(workflow.obsidian, true);
		await expectOwnerVisible(workflow.obsidian, true);
		expect(await workflow.obsidian.dev.evalJson<string>(
			'document.activeElement?.getAttribute("aria-labelledby") ?? ""',
		)).toBe("qa-onepage-label-owner");
		await typeInto(workflow.obsidian, formField("owner"), "Keyboard owner");
		await pressEnter(workflow.obsidian, true);
		await expectKeyboardCreated(workflow, title, "Owner: Keyboard owner");
	});

	it("one Mod+Enter submits a pending title when no template questions remain", async () => {
		const workflow = await seedCombinedWorkflow("keyboard-no-template-fields", { templateBody: "Plain template\n" });
		await waitForElement(workflow.obsidian, ".onePageInputModal");
		await fillKeyboardCapture(workflow);
		const title = await typeFuzzyNewTitle(workflow);
		await pressEnter(workflow.obsidian, true);
		await expectKeyboardCreated(workflow, title, "Plain template");
	});

	it("Enter selects an exact existing title without showing template questions", async () => {
		const workflow = await seedCombinedWorkflow("keyboard-exact");
		await waitForElement(workflow.obsidian, ".onePageInputModal");
		await fillKeyboardCapture(workflow);
		await typeInto(workflow.obsidian, `[aria-label=${JSON.stringify(`Note for ${workflow.template.name}`)}]`, workflow.noteName);
		await waitForExactSuggestion(workflow);
		await pressEnter(workflow.obsidian);
		await expectOwnerVisible(workflow.obsidian, false);
		expect(await workflow.obsidian.dev.evalJson<string>(
			'document.querySelector(".qa-onepage-file-picker__chip-label")?.textContent ?? ""',
		)).toBe(workflow.sandbox.path(workflow.relativePath).replace(/\.md$/, ""));
		await pressEnter(workflow.obsidian, true);
		const content = await workflow.sandbox.waitForContent(workflow.relativePath, (text) => text.includes("Keyboard capture Keyboard details"), WAIT_OPTS);
		expect(content.trimEnd()).toBe("# Existing note\n\nKeyboard capture Keyboard details");
		await expectNoPrompt(workflow.obsidian);
	});

	it("an invalid pending title keeps the form open and preserves entered capture answers", async () => {
		const workflow = await seedCombinedWorkflow("keyboard-invalid");
		await waitForElement(workflow.obsidian, ".onePageInputModal");
		await fillKeyboardCapture(workflow);
		const input = `[aria-label=${JSON.stringify(`Note for ${workflow.template.name}`)}]`;
		await typeInto(workflow.obsidian, input, "../outside");
		await pressEnter(workflow.obsidian, true);
		expect(await workflow.obsidian.dev.evalJson<boolean>(
			'Boolean(document.querySelector(".onePageInputModal")) && !document.querySelector(".qa-onepage-file-picker__chip")',
		)).toBe(true);
		expect(await workflow.sandbox.read(workflow.relativePath)).toBe("# Existing note\n");
		await typeInto(workflow.obsidian, input, workflow.noteName);
		await waitForExactSuggestion(workflow);
		await pressEnter(workflow.obsidian);
		await pressEnter(workflow.obsidian, true);
		const content = await workflow.sandbox.waitForContent(workflow.relativePath, (text) => text.includes("Keyboard capture Keyboard details"), WAIT_OPTS);
		expect(content.trimEnd()).toBe("# Existing note\n\nKeyboard capture Keyboard details");
		await expectNoPrompt(workflow.obsidian);
	});
});
