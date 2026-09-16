import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import GenericYesNoPrompt from "./GenericYesNoPrompt";

import { ButtonComponent, Modal } from "obsidian";

ButtonComponent.prototype.setDestructive ??= function () { return this; };
const openModal = vi.spyOn(Modal.prototype, "open");

function clickButton(text: string): void {
	const button = Array.from(document.querySelectorAll("button")).find(
		(buttonEl) => buttonEl.textContent === text,
	);
	button?.click();
}

/** Esc / the close button / a click outside — Obsidian closes the modal. */
function dismiss(): void {
	const modal = openModal.mock.instances.at(-1);
	if (modal instanceof Modal) modal.close();
}

describe("GenericYesNoPrompt", () => {
	afterEach(() => {
		document.body.replaceChildren();
		openModal.mockClear();
	});

	// The contract, in one place: walking away from the dialog is an answer, not
	// an error. It used to reject with a bare "No answer given." string, which
	// turned every cancelled confirmation into an unhandled rejection at the
	// call sites that (reasonably) just awaited a boolean (#1567).
	describe("contract", () => {
		it.each([
			["Yes", true],
			["No", false],
		])("Ask resolves %s as %s", async (buttonText, expected) => {
			const answer = GenericYesNoPrompt.Ask({} as App, "Confirm", "Continue?");
			clickButton(buttonText);
			await expect(answer).resolves.toBe(expected);
		});

		it("Ask resolves null when the dialog is dismissed", async () => {
			const answer = GenericYesNoPrompt.Ask({} as App, "Confirm", "Continue?");
			dismiss();
			await expect(answer).resolves.toBeNull();
		});

		it("Prompt resolves false when the dialog is dismissed", async () => {
			const answer = GenericYesNoPrompt.Prompt(
				{} as App,
				"Confirm",
				"Continue?",
			);
			dismiss();
			await expect(answer).resolves.toBe(false);
		});

		it.each([
			["Ask", () => GenericYesNoPrompt.Ask({} as App, "Confirm")],
			["Prompt", () => GenericYesNoPrompt.Prompt({} as App, "Confirm")],
		])("%s never rejects on dismissal", async (_name, open) => {
			const onRejected = vi.fn();
			const answer = open().catch(onRejected);
			dismiss();
			await answer;
			expect(onRejected).not.toHaveBeenCalled();
		});
	});

	it.each([
		["Yes", "mousedown", true],
		["No", "mousedown", false],
		["Yes", "pointerdown", true],
		["No", "pointerdown", false],
	])(
		"prevents prompt button %s %s from reaching the editor before click submit",
		async (buttonText, eventName, expectedAnswer) => {
			const waitForClose = GenericYesNoPrompt.Prompt(
				{} as App,
				"Confirm",
				"Continue?",
			);
			const button = Array.from(document.querySelectorAll("button")).find(
				(buttonEl) => buttonEl.textContent === buttonText,
			);
			const editorPointerPress = vi.fn();
			document.body.addEventListener(eventName, editorPointerPress);

			const pointerPress = new Event(eventName, {
				bubbles: true,
				cancelable: true,
			});
			button?.dispatchEvent(pointerPress);

			expect(pointerPress.defaultPrevented).toBe(true);
			expect(editorPointerPress).not.toHaveBeenCalled();

			button?.click();

			await expect(waitForClose).resolves.toBe(expectedAnswer);
		},
	);
});
