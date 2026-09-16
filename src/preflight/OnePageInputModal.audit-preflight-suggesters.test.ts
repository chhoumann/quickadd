import { ensureObsidianDomPolyfills, modalButton } from "../../tests/helpers/preflight/modal";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { FieldRequirement } from "./RequirementCollector";

const { noticeMessages } = vi.hoisted(() => ({
	noticeMessages: [] as string[],
}));

vi.mock("obsidian", async () => {
	const { modalObsidianStub } = await import("../../tests/helpers/preflight/modal");
	return modalObsidianStub(noticeMessages);
});

vi.mock("src/gui/suggesters/fileSuggester", () => ({
	FileSuggester: class {
		destroy = vi.fn();
	},
}));

vi.mock("src/gui/suggesters/tagSuggester", () => ({
	TagSuggester: class {
		destroy = vi.fn();
	},
}));

vi.mock("src/gui/promptPeek/stylePeekButton", () => ({
	applyCompactPromptChrome: vi.fn(),
	stylePeekButton: <T extends { buttonEl: HTMLButtonElement }>(button: T): T => {
		button.buttonEl.textContent = "Peek at note";
		button.buttonEl.classList.add("qa-peek-button");
		return button;
	},
}));

vi.mock("src/gui/date-picker/datePicker", () => ({
	createDatePicker: () => ({ setSelectedIso: vi.fn() }),
}));

vi.mock("src/gui/suggesters/FieldValueInputSuggest", () => ({
	FieldValueInputSuggest: class {},
}));

vi.mock("src/gui/suggesters/SuggesterInputSuggest", () => ({
	SuggesterInputSuggest: class {},
}));

vi.mock("src/settingsStore", () => ({
	settingsStore: { getState: () => ({ dateAliases: {} }) },
}));

import { OnePageInputModal } from "./OnePageInputModal";


const findSubmit = (modal: OnePageInputModal): HTMLButtonElement =>
	modalButton(modal);

describe("OnePageInputModal preflight-suggesters audit", () => {
	beforeEach(() => {
		ensureObsidianDomPolyfills();
		noticeMessages.length = 0;
	});

	// Finding: api-request-inputs — a required date with a typo would be silently
	// dropped as "" instead of blocking Submit; ensure Submit is blocked with a
	// notice and that fixing the value unblocks it.
	describe("required date parse-error gating", () => {
		it("blocks Submit and shows a notice while a required date fails to parse", async () => {
			const requirements: FieldRequirement[] = [
				{
					id: "due",
					label: "Due date",
					type: "date",
					dateFormat: "YYYY-MM-DD",
				},
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			const dateInput = modal.contentEl.querySelector(
				"input",
			) as HTMLInputElement;
			dateInput.value = "next fryday";
			dateInput.dispatchEvent(new Event("input", { bubbles: true }));

			let settled = false;
			void modal.waitForClose.then(() => (settled = true));

			findSubmit(modal).click();
			await Promise.resolve();

			expect(settled).toBe(false);
			expect(noticeMessages).toHaveLength(1);
			expect(noticeMessages[0]).toContain("Due date");
		});

		it("submits once the parse error is cleared (blocking is specific to the error)", async () => {
			const requirements: FieldRequirement[] = [
				{
					id: "due",
					label: "Due date",
					type: "date",
					dateFormat: "YYYY-MM-DD",
				},
				{ id: "note", label: "Note", type: "text" },
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			const dateInput = modal.contentEl.querySelector(
				"input",
			) as HTMLInputElement;

			// Typo -> parse error -> Submit blocked.
			dateInput.value = "garbage";
			dateInput.dispatchEvent(new Event("input", { bubbles: true }));
			findSubmit(modal).click();
			expect(noticeMessages).toHaveLength(1);

			// Clearing the field removes the parse error; a required blank date is
			// omitted (so the sequential prompt can fire) and Submit proceeds.
			dateInput.value = "";
			dateInput.dispatchEvent(new Event("input", { bubbles: true }));
			findSubmit(modal).click();

			await expect(modal.waitForClose).resolves.toEqual({ note: "" });
		});
	});

	// Finding: prompts-gui-onepage-preflight-modal — the modal must auto-focus
	// the first field and submit on Mod+Enter without the mouse.
	describe("keyboard accessibility", () => {
		it("auto-focuses the first field on open", () => {
			const requirements: FieldRequirement[] = [
				{ id: "title", label: "Title", type: "text" },
				{ id: "body", label: "Body", type: "textarea" },
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			// jsdom only updates activeElement for elements in the document.
			document.body.appendChild((modal as any).containerEl);
			(modal as any).open();

			const firstInput = modal.contentEl.querySelector(
				"input",
			) as HTMLInputElement;
			expect(document.activeElement).toBe(firstInput);
		});

		it("submits on Mod+Enter via the modal scope", async () => {
			const requirements: FieldRequirement[] = [
				{ id: "title", label: "Title", type: "text" },
			];
			const modal = new OnePageInputModal({} as App, requirements, new Map());
			(modal as any).open();

			const input = modal.contentEl.querySelector(
				"input",
			) as HTMLInputElement;
			input.value = "Hello";
			input.dispatchEvent(new Event("input", { bubbles: true }));

			(modal as any).scope.trigger(["Mod"], "Enter");

			await expect(modal.waitForClose).resolves.toEqual({ title: "Hello" });
		});
	});
});
