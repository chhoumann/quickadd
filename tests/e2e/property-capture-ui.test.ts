import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ObsidianClient } from "obsidian-e2e";
import { CaptureChoice } from "../../src/types/choices/CaptureChoice";
import type IChoice from "../../src/types/choices/IChoice";
import { MacroChoice } from "../../src/types/choices/MacroChoice";
import { TemplateChoice } from "../../src/types/choices/TemplateChoice";
import { NestedChoiceCommand } from "../../src/types/macros/QuickCommands/NestedChoiceCommand";
import { createQuickAddE2EHarness, seedVaultFile } from "./e2eVault";

const getContext = createQuickAddE2EHarness("property-capture-ui");
const POLL_OPTS = { timeout: 10_000, interval: 200 };
const BODY = "\n# Project\n\nKeep the body unchanged.\n";
const NUMBER_INPUT = '.qaInputPrompt input[type="number"]';
const TEXT_INPUT = '.qaInputPrompt input[type="text"], .qaInputPrompt textarea';
const PROPERTY_INPUT = '.prompt input[placeholder="Property"]';

type QuickAddData = { choices: IChoice[]; onePageInputEnabled: boolean };

async function waitForElement(obsidian: ObsidianClient, selector: string) {
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		`Boolean(document.querySelector(${JSON.stringify(selector)})?.getClientRects().length)`,
	), POLL_OPTS).toBe(true);
}

async function pressKey(obsidian: ObsidianClient, key: "Enter" | "Escape" | "F8", modified = false) {
	const mod = (await obsidian.dev.evalJson<string>("process.platform")) === "darwin" ? 4 : 2;
	const codes = { Enter: 13, Escape: 27, F8: 119 };
	for (const type of ["keyDown", "keyUp"]) {
		await obsidian.exec("dev:cdp", {
			method: "Input.dispatchKeyEvent",
			params: JSON.stringify({
				type, key, code: key, windowsVirtualKeyCode: codes[key],
				modifiers: modified ? mod | (key === "F8" ? 8 : 0) : 0,
			}),
		});
	}
}

async function typeInto(obsidian: ObsidianClient, selector: string, text: string) {
	await waitForElement(obsidian, selector);
	expect(await obsidian.dev.evalJson<boolean>(`(() => {
		const input = document.querySelector(${JSON.stringify(selector)});
		if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return false;
		input.focus();
		input.select();
		return true;
	})()`)).toBe(true);
	await obsidian.exec("dev:cdp", {
		method: "Input.insertText", params: JSON.stringify({ text }),
	});
	await expect.poll(() => obsidian.dev.evalJson<string>(
		`document.querySelector(${JSON.stringify(selector)})?.value ?? ""`,
	), POLL_OPTS).toBe(text);
}

async function expectNoPrompt(obsidian: ObsidianClient) {
	await expect.poll(() => obsidian.dev.evalJson<boolean>(
		'Boolean(document.querySelector(".modal-container, .prompt"))',
	), POLL_OPTS).toBe(false);
}

async function closeOpenPrompts() {
	const { obsidian } = getContext();
	for (let remaining = 5; remaining > 0; remaining--) {
		if (!await obsidian.dev.evalJson<boolean>('Boolean(document.querySelector(".modal-container, .prompt"))')) break;
		await pressKey(obsidian, "Escape");
	}
	await expectNoPrompt(obsidian);
}

beforeEach(closeOpenPrompts);
afterEach(closeOpenPrompts);

function choiceFor(name: string, path: string, property: string) {
	const choice = new CaptureChoice(name);
	choice.command = true;
	choice.captureTo = path;
	choice.onePageInput = "never";
	choice.useSelectionAsCaptureValue = false;
	choice.propertyCapture = {
		property: { kind: "named", format: property }, action: "set", createIfMissing: true,
	};
	return choice;
}

async function saveChoice(choice: IChoice, onePage = false) {
	const { plugin } = getContext();
	await plugin.data<QuickAddData>().patch((data) => {
		data.choices.push(choice);
		data.onePageInputEnabled = onePage;
	});
	await plugin.reload({ waitUntilReady: true });
}

async function readNote(path: string) {
	const { obsidian } = getContext();
	const content = await obsidian.dev.evalJsonAsync<string>(
		`app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))`,
	);
	const properties = await obsidian.metadata.frontmatter(path);
	return {
		properties: properties ?? {},
		body: content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ""),
	};
}

describe("property capture through native keyboard prompts", () => {
	it("uses a numeric input for default VALUE and stores zero through a hotkey", async () => {
		const { obsidian, sandbox } = getContext();
		const property = "qa_ui_capture_count";
		const path = await seedVaultFile(obsidian, sandbox, "number.md", `---\n${property}: 7\nkeep: unchanged\n---\n${BODY}`);
		const choice = choiceFor("Capture number by hotkey", path, property);
		await saveChoice(choice);
		const commandId = `quickadd:choice:${choice.id}`;
		expect(await obsidian.dev.evalJson<boolean>(`(() => {
			const commandId = ${JSON.stringify(commandId)};
			app.hotkeyManager.setHotkeys(commandId, [{ modifiers: ["Mod", "Shift"], key: "F8" }]);
			return Boolean(app.commands.commands[commandId]);
		})()`)).toBe(true);
		try {
			await pressKey(obsidian, "F8", true);
			await waitForElement(obsidian, NUMBER_INPUT);
		} finally {
			await obsidian.dev.evalJson<boolean>(`(() => {
				app.hotkeyManager.removeHotkeys(${JSON.stringify(commandId)});
				return true;
			})()`);
		}
		await typeInto(obsidian, NUMBER_INPUT, "0");
		await pressKey(obsidian, "Enter");
		await expectNoPrompt(obsidian);
		await expect.poll(() => readNote(path), POLL_OPTS).toEqual({
			properties: { [property]: 0, keep: "unchanged" }, body: BODY,
		});
	});

	it("offers true and false for a checkbox property and stores false through a direct command", async () => {
		const { obsidian, sandbox } = getContext();
		const property = "qa_ui_capture_done";
		const path = await seedVaultFile(obsidian, sandbox, "checkbox.md", `---\n${property}: true\n---\n${BODY}`);
		const choice = choiceFor("Capture checkbox by command", path, property);
		await saveChoice(choice);
		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });
		const input = '.prompt input.prompt-input';
		await waitForElement(obsidian, input);
		await expect.poll(() => obsidian.dev.evalJson<string[]>(
			'Array.from(document.querySelectorAll(".prompt .suggestion-item")).map((item) => item.textContent.trim())',
		), POLL_OPTS).toEqual(["true", "false"]);
		await typeInto(obsidian, input, "false");
		await expect.poll(() => obsidian.dev.evalJson<string>(
			'document.querySelector(".prompt .suggestion-item.is-selected")?.textContent.trim() ?? ""',
		), POLL_OPTS).toBe("false");
		await pressKey(obsidian, "Enter");
		await expectNoPrompt(obsidian);
		await expect.poll(() => readNote(path), POLL_OPTS).toEqual({
			properties: { [property]: false }, body: BODY,
		});
	});

	it("defers a runtime property value with one-page input enabled and stores commas as one list item", async () => {
		const { obsidian, sandbox } = getContext();
		const path = await seedVaultFile(obsidian, sandbox, "runtime-list.md", `---\ntags: [original]\nstatus: active\n---\n${BODY}`);
		const choice = choiceFor("Choose a property then capture", path, "unused");
		choice.onePageInput = "always";
		choice.propertyCapture = { property: { kind: "prompt" }, action: "set", createIfMissing: false };
		await saveChoice(choice, true);
		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });
		await waitForElement(obsidian, PROPERTY_INPUT);
		expect(await obsidian.dev.evalJson<boolean>(
			'Boolean(document.querySelector(".onePageInputModal, .qaInputPrompt"))',
		)).toBe(false);
		await typeInto(obsidian, PROPERTY_INPUT, "tags");
		await expect.poll(() => obsidian.dev.evalJson<string>(
			'document.querySelector(".prompt .suggestion-item.is-selected")?.textContent.trim() ?? ""',
		), POLL_OPTS).toBe("tags");
		await pressKey(obsidian, "Enter");
		await typeInto(obsidian, TEXT_INPUT, "a,b");
		expect((await readNote(path)).properties).toEqual({ tags: ["original"], status: "active" });
		await pressKey(obsidian, "Enter");
		await expectNoPrompt(obsidian);
		await expect.poll(() => readNote(path), POLL_OPTS).toEqual({
			properties: { tags: ["a,b"], status: "active" }, body: BODY,
		});
	});

	it("cancels the default value prompt before creating a configured target", async () => {
		const { obsidian, sandbox } = getContext();
		const path = sandbox.path("cancelled/new-note.md");
		const choice = choiceFor("Cancel before creating a property capture", path, "qa_ui_capture_new_text");
		choice.createFileIfItDoesntExist.enabled = true;
		await saveChoice(choice);
		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });
		await typeInto(obsidian, TEXT_INPUT, "Unsubmitted value");
		const exists = () => obsidian.dev.evalJson<boolean>(
			`Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(path)}))`,
		);
		expect(await exists()).toBe(false);
		await pressKey(obsidian, "Escape");
		await expectNoPrompt(obsidian);
		expect(await exists()).toBe(false);
		expect(await obsidian.dev.evalJson<boolean>(
			`Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(sandbox.path("cancelled"))}))`,
		)).toBe(false);
	});

	it("keeps the native number widget in the combined form for a known property", async () => {
		const { obsidian, sandbox } = getContext();
		const property = "qa_ui_capture_form_count";
		const path = await seedVaultFile(obsidian, sandbox, "one-page-number.md", `---\n${property}: 8\n---\n${BODY}`);
		await expect.poll(() => obsidian.metadata.frontmatter(path), POLL_OPTS)
			.toEqual({ [property]: 8 });
		await expect.poll(() => obsidian.dev.evalJson<string | null>(
			`app.metadataTypeManager.getAllProperties()[${JSON.stringify(property)}]?.widget ?? null`,
		), POLL_OPTS).toBe("number");
		const choice = choiceFor("Capture a number in one form", path, property);
		choice.onePageInput = "always";
		await saveChoice(choice, true);
		await obsidian.exec("command", { id: `quickadd:choice:${choice.id}` });
		const input = '.onePageInputModal input[type="number"]';
		await typeInto(obsidian, input, "0");
		expect((await readNote(path)).properties).toEqual({ [property]: 8 });
		await pressKey(obsidian, "Enter", true);
		await expectNoPrompt(obsidian);
		await expect.poll(() => readNote(path), POLL_OPTS).toEqual({
			properties: { [property]: 0 }, body: BODY,
		});
	});

	it("submits one form to append a discovered template and update that note's property", async () => {
		const { obsidian, sandbox } = getContext();
		const template = new TemplateChoice("Discover a project and append its owner");
		const noteName = `Combined property project ${template.id}`;
		const path = await seedVaultFile(obsidian, sandbox, `${noteName}.md`, `---\nstatus: active\nkeep: unchanged\n---\n${BODY}`);
		template.templatePath = await seedVaultFile(obsidian, sandbox, "owner-template.md", "Owner: {{VALUE:owner}}\n");
		template.fileNameFormat = { enabled: true, format: "{{VALUE}}" };
		template.discoverExistingNotesBeforeCreate = true;
		template.existingNoteAction = "appendBottom";
		template.openFile = true;
		const capture = new CaptureChoice("Update the selected project's status");
		capture.captureToActiveFile = true;
		capture.useSelectionAsCaptureValue = false;
		capture.format = { enabled: true, format: "{{VALUE:state}}" };
		capture.propertyCapture = {
			property: { kind: "named", format: "status" }, action: "set", createIfMissing: false,
		};
		const macro = new MacroChoice("Append project owner and update status");
		macro.command = true;
		macro.onePageInput = "always";
		macro.macro.commands = [new NestedChoiceCommand(template), new NestedChoiceCommand(capture)];
		await expect.poll(() => obsidian.metadata.frontmatter(path), POLL_OPTS)
			.toEqual({ status: "active", keep: "unchanged" });
		await saveChoice(macro, true);
		await obsidian.exec("command", { id: `quickadd:choice:${macro.id}` });
		const noteInput = `[aria-label=${JSON.stringify(`Note for ${template.name}`)}]`;
		await typeInto(obsidian, noteInput, noteName);
		await expect.poll(() => obsidian.dev.evalJson<string>(
			'document.querySelector(".qa-onepage-file-suggestion__path")?.textContent ?? ""',
		), POLL_OPTS).toBe(path);
		await pressKey(obsidian, "Enter");
		await typeInto(obsidian, '.onePageInputModal [aria-labelledby="qa-onepage-label-owner"]', "Ada");
		await typeInto(obsidian, '.onePageInputModal [aria-labelledby="qa-onepage-label-state"]', "done");
		expect(await readNote(path)).toEqual({
			properties: { status: "active", keep: "unchanged" }, body: BODY,
		});
		await pressKey(obsidian, "Enter", true);
		await expect.poll(() => readNote(path), POLL_OPTS).toEqual({
			properties: { status: "done", keep: "unchanged" }, body: `${BODY}\nOwner: Ada\n`,
		});
		await expectNoPrompt(obsidian);
		expect(await obsidian.dev.evalJson<string | null>("app.workspace.getActiveFile()?.path ?? null"))
			.toBe(path);
	});
});
