import { describe, expect, it } from "vitest";
import { App } from "obsidian";
import { render } from "@testing-library/svelte";
import { flushSync } from "svelte";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import CaptureChoiceForm from "./CaptureChoiceForm.svelte";
import TemplateChoiceForm from "./TemplateChoiceForm.svelte";
import { createCaptureChoiceFormProps } from "./captureChoiceFormProps.svelte";
import { createTemplateChoiceFormProps } from "./templateChoiceFormProps.svelte";
import { openMoreSettings } from "../../../tests/helpers/settings/fields";

// The builders say "note" for what QuickAdd writes, like the rest of QuickAdd 3;
// a Canvas target is still a canvas.
const plugin = { getTemplateFiles: () => [], settings: { choices: [] } } as unknown as QuickAdd;

/** Every label, description, option and aria-label the user can see. */
function visibleWords(container: HTMLElement): string[] {
	const texts = [
		...Array.from(container.querySelectorAll(".setting-item-name, .setting-item-description, .setting-item-heading, option, button, label"), (el) => el.textContent ?? ""),
		...Array.from(container.querySelectorAll("[aria-label]"), (el) => el.getAttribute("aria-label") ?? ""),
		...Array.from(container.querySelectorAll("[placeholder]"), (el) => el.getAttribute("placeholder") ?? ""),
	];
	return texts.map((text) => text.trim()).filter(Boolean);
}

function saysFile(texts: string[]): string[] {
	// `file-text` is the default choice icon's id, not a word.
	const words = (text: string) => text.replace(/\bfile-text\b/g, "");
	return [...new Set(texts.filter((text) => /\bfiles?\b/i.test(words(text)) && !/canvas/i.test(text)))];
}

function capture(overrides: Partial<ICaptureChoice>): ICaptureChoice {
	const choice = new CaptureChoice("Capture");
	Object.assign(choice, {
		createFileIfItDoesntExist: { enabled: true, createWithTemplate: true, template: "" },
		appendLink: { enabled: true, placement: "newLine", requireActiveFile: false },
		openFile: true,
		...overrides,
	});
	return choice;
}

function template(): ITemplateChoice {
	const choice = new TemplateChoice("Template");
	choice.appendLink = { enabled: true, placement: "newLine", requireActiveFile: true };
	choice.openFile = true;
	choice.folder = { ...choice.folder, enabled: true, folders: ["Notes"] };
	return choice;
}

function captureWords(choice: ICaptureChoice): string[] {
	const props = createCaptureChoiceFormProps({ choice, app: new App(), plugin });
	const { container } = render(CaptureChoiceForm, { props: { choice: props.choice, app: props.app, plugin: props.plugin } });
	openMoreSettings(container);
	flushSync();
	return visibleWords(container);
}

describe("the builders say note, not file", () => {
	it("in the Template page", () => {
		for (const mode of ["overwrite", "doNothing"] as const) {
			const choice = template();
			choice.fileExistsBehavior = { kind: "apply", mode };
			const props = createTemplateChoiceFormProps({ choice, app: new App(), plugin });
			const { container, unmount } = render(TemplateChoiceForm, { props: { choice: props.choice, app: props.app, plugin: props.plugin } });
			openMoreSettings(container);
			flushSync();
			expect(saysFile(visibleWords(container))).toEqual([]);
			unmount();
		}
	});

	it("in the Capture page, to a note and to the active note", () => {
		expect(saysFile(captureWords(capture({ captureTo: "Inbox.md" })))).toEqual([]);
		expect(saysFile(captureWords(capture({ captureToActiveFile: true })))).toEqual([]);
		expect(saysFile(captureWords(capture({ captureTo: "Inbox.md", insertAfter: { enabled: true, after: "## A", insertAtEnd: false, considerSubsections: false, createIfNotFound: true, createIfNotFoundLocation: "top" } })))).toEqual([]);
	});
});
