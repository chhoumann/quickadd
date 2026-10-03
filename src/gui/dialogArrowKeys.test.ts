import type { App } from "obsidian";
import { afterEach, describe, expect, it } from "vitest";
import { ButtonComponent } from "obsidian";
import GenericYesNoPrompt from "./GenericYesNoPrompt/GenericYesNoPrompt";
import AIToolConfirmModal from "./AIToolConfirmModal";

ButtonComponent.prototype.setDestructive ??= function () { return this; };

function button(text: string): HTMLButtonElement {
	const found = Array.from(document.querySelectorAll("button")).find((el) => el.textContent === text);
	if (!found) throw new Error(`no button ${text}`);
	return found;
}

function press(key: string): void {
	(document.activeElement as HTMLElement).dispatchEvent(
		new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
	);
}

afterEach(() => document.body.replaceChildren());

describe("arrow keys move focus between a dialog's buttons", () => {
	it("wraps around in the yes/no prompt", () => {
		void GenericYesNoPrompt.Ask({} as App, "Confirm", "Continue?");
		expect(document.activeElement).toBe(button("Yes"));
		press("ArrowRight");
		expect(document.activeElement).toBe(button("No"));
		press("ArrowRight");
		expect(document.activeElement).toBe(button("Yes"));
		press("ArrowLeft");
		expect(document.activeElement).toBe(button("No"));
		press("Enter");
		expect(document.activeElement).toBe(button("No"));
	});

	it("walks the tool confirmation buttons in order", () => {
		void AIToolConfirmModal.Prompt({} as App, "create_note", { path: "a.md" });
		expect(document.activeElement).toBe(button("Deny"));
		press("ArrowRight");
		expect(document.activeElement).toBe(button("Approve all this run"));
		press("ArrowRight");
		expect(document.activeElement).toBe(button("Approve"));
		press("ArrowRight");
		expect(document.activeElement).toBe(button("Abort run"));
		press("ArrowLeft");
		expect(document.activeElement).toBe(button("Approve"));
	});
});
