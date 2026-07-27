import { describe, expect, it } from "vitest";
import { mountSystemPromptLiteralNote } from "./systemPromptLiteralNote";

function host(): { container: HTMLElement; field: HTMLTextAreaElement } {
	const container = document.createElement("div");
	const field = document.createElement("textarea");
	container.appendChild(field);
	document.body.appendChild(container);
	return { container, field };
}

function noteOf(container: HTMLElement): HTMLElement {
	const note = container.querySelector<HTMLElement>(".qa-literal-format-note");
	expect(note).not.toBeNull();
	return note as HTMLElement;
}

/** The class the stylesheet keys `display: block` off. */
function isShown(container: HTMLElement): boolean {
	return noteOf(container).classList.contains("qa-literal-format-note--shown");
}

describe("mountSystemPromptLiteralNote", () => {
	it("stays hidden for a prose prompt", () => {
		const { container, field } = host();
		mountSystemPromptLiteralNote(
			container,
			field,
			"As an AI assistant within Obsidian, your primary goal is to help users.",
		);

		expect(isShown(container)).toBe(false);
	});

	it("shows for a prompt that already contains a token", () => {
		const { container, field } = host();
		mountSystemPromptLiteralNote(container, field, "Today is {{DATE}}.");

		expect(isShown(container)).toBe(true);
	});

	it("follows the value as the field is edited, in both directions", () => {
		const { container, field } = host();
		const update = mountSystemPromptLiteralNote(container, field, "");

		expect(isShown(container)).toBe(false);
		update("You are helpful.");
		expect(isShown(container)).toBe(false);
		update("You are helpful. Today is {{DATE}}.");
		expect(isShown(container)).toBe(true);
		update("You are helpful.");
		expect(isShown(container)).toBe(false);
	});

	it("describes the field only while the note is visible", () => {
		// An accessible description may include a directly-referenced HIDDEN node,
		// so a permanent reference would describe the field with a line the sighted
		// user cannot see.
		const { container, field } = host();
		const update = mountSystemPromptLiteralNote(container, field, "");

		expect(field.hasAttribute("aria-describedby")).toBe(false);

		update("Today is {{DATE}}.");
		const id = field.getAttribute("aria-describedby");
		expect(id).toBeTruthy();
		expect(noteOf(container).id).toBe(id);

		update("Today is Monday.");
		expect(field.hasAttribute("aria-describedby")).toBe(false);
	});

	it("gives each mount its own id, so two notes never collide", () => {
		const a = host();
		const b = host();
		mountSystemPromptLiteralNote(a.container, a.field, "{{DATE}}");
		mountSystemPromptLiteralNote(b.container, b.field, "{{DATE}}");

		expect(noteOf(a.container).id).not.toBe(noteOf(b.container).id);
		expect(a.field.getAttribute("aria-describedby")).toBe(
			noteOf(a.container).id,
		);
		expect(b.field.getAttribute("aria-describedby")).toBe(
			noteOf(b.container).id,
		);
	});

	it("names the token syntax it is about and points at the prompt template", () => {
		const { container, field } = host();
		mountSystemPromptLiteralNote(container, field, "{{DATE}}");

		const text = noteOf(container).textContent ?? "";
		expect(text).toContain("{{DATE}}");
		expect(text).toContain("prompt template");
	});

	it("exists in the DOM while hidden, so it renders under its own field", () => {
		// Created up front rather than on demand: these modals append as they build,
		// so a lazily created note would land at the bottom of the modal.
		const { container, field } = host();
		mountSystemPromptLiteralNote(container, field, "no tokens here");
		const trailing = container.createEl("div");

		const note = noteOf(container);
		expect(
			field.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			trailing.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_PRECEDING,
		).toBeTruthy();
	});
});
