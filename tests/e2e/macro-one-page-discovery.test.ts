import { afterEach, describe, expect, it } from "vitest";
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

afterEach(async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson<boolean>(`(() => {
		for (const close of document.querySelectorAll(".modal-container .modal-close-button")) close.click();
		return true;
	})()`);
});

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

async function seedCombinedWorkflow(name: string, templateOverride?: "never", twoCaptures = false) {
	const { obsidian, plugin, sandbox } = getContext();
	const noteName = `Existing ${name}`;
	const relativePath = `${name}/${noteName}.md`;
	await seedVaultFile(obsidian, sandbox, relativePath, "# Existing note\n");
	const template = new TemplateChoice(`Discover ${name}`);
	template.templatePath = await seedVaultFile(obsidian, sandbox, `${name}/template.md`, "Owner: {{VALUE:owner}}\n");
	template.onePageInput = templateOverride;
	template.discoverExistingNotesBeforeCreate = true;
	template.fileNameFormat = { enabled: true, format: "{{VALUE}}" };
	template.folder = { ...template.folder, enabled: true, folders: [sandbox.path(name)] };
	template.openFile = true;
	const captures = Array.from({ length: twoCaptures ? 2 : 1 }, (_, index) => {
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
	await expect.poll(() => obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".modal-container"))'),
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
		const { obsidian, sandbox, template, macro, noteName, relativePath } = await seedCombinedWorkflow("grouped-after-picker", "never", true);
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
