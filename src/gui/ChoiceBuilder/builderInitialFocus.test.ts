import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// FormatPreviewField -> formatter graph pulls obsidian-dataview's CJS require.
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { App, Modal } from "obsidian";
import type QuickAdd from "../../main";
import { CaptureChoice } from "../../types/choices/CaptureChoice";
import { MacroChoice } from "../../types/choices/MacroChoice";
import { TemplateChoice } from "../../types/choices/TemplateChoice";
import { MacroBuilder } from "../MacroGUIs/MacroBuilder";
import { CaptureChoiceBuilder } from "./captureChoiceBuilder";
import { TemplateChoiceBuilder } from "./templateChoiceBuilder";

const plugin = {
	getTemplateFiles: () => [],
	settings: { choices: [] },
} as unknown as QuickAdd;

// The builders opened with focus on different elements: the Macro builder's
// title rename button (a focus ring around the title), the Template/Capture
// builders' footer Done. Cause: Obsidian's Modal.open() focuses the first
// focusable element in modalEl, and only the Macro builder builds its content
// before open(). The stub's open() does not autofocus, so emulate it here;
// otherwise a fix that focuses Done before open() would pass the test but lose
// to open() in Obsidian.
describe("choice builder initial focus", () => {
	beforeEach(() => {
		const open = Modal.prototype.open;
		vi.spyOn(Modal.prototype, "open").mockImplementation(function (
			this: InstanceType<typeof Modal>,
		) {
			open.call(this);
			this.modalEl
				.querySelector<HTMLElement>("button, input, select, textarea, [tabindex]")
				?.focus();
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		document.body.replaceChildren();
	});

	it.each([
		["Macro", () => new MacroBuilder(new App(), plugin, new MacroChoice("Macro"), [])],
		["Template", () => new TemplateChoiceBuilder(new App(), new TemplateChoice("Template"), plugin)],
		["Capture", () => new CaptureChoiceBuilder(new App(), new CaptureChoice("Capture"), plugin)],
	])("%s builder opens with focus on the footer's Done", (_type, openBuilder) => {
		const modal = openBuilder();

		const done = modal.modalEl.querySelector(".qa-builder-footer button.mod-cta");
		expect(done?.textContent).toBe("Done");
		expect(document.activeElement).toBe(done);
	});
});
