// @vitest-environment jsdom
import type { App } from "obsidian";
import { ConfirmationModal } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmAction } from "./confirmAction";

const openModal = vi.spyOn(ConfirmationModal.prototype, "open");

function button(text: string): HTMLButtonElement | undefined {
	return Array.from(document.querySelectorAll("button")).find(
		(buttonEl) => buttonEl.textContent === text,
	);
}

function ask(): Promise<boolean> {
	return confirmAction({} as App, {
		title: "Delete “Inbox”?",
		message: "The choice will be removed.",
		action: "Delete",
	});
}

describe("confirmAction", () => {
	afterEach(() => {
		document.body.replaceChildren();
		openModal.mockClear();
	});

	it("confirms only through the action button", async () => {
		const answer = ask();
		button("Delete")?.click();
		await expect(answer).resolves.toBe(true);
	});

	it("resolves false on Cancel", async () => {
		const answer = ask();
		button("Cancel")?.click();
		await expect(answer).resolves.toBe(false);
	});

	it("resolves false when the dialog is dismissed", async () => {
		const answer = ask();
		(openModal.mock.instances.at(-1) as unknown as ConfirmationModal).close();
		await expect(answer).resolves.toBe(false);
	});

	it("styles the action as destructive unless told otherwise", () => {
		void ask();
		expect(button("Delete")?.classList.contains("mod-destructive")).toBe(true);
		document.body.replaceChildren();

		void confirmAction({} as App, { title: "Move?", action: "Move", destructive: false });
		expect(button("Move")?.classList.contains("mod-destructive")).toBe(false);
	});

	// #443: a press on a dialog button reached the editor below and moved its caret.
	it.each(["Delete", "Cancel"])("keeps a pointer press on %s from reaching the editor", (text) => {
		void ask();
		const editorPress = vi.fn();
		document.body.addEventListener("pointerdown", editorPress);
		const press = new Event("pointerdown", { bubbles: true, cancelable: true });

		button(text)?.dispatchEvent(press);

		expect(press.defaultPrevented).toBe(true);
		expect(editorPress).not.toHaveBeenCalled();
		document.body.removeEventListener("pointerdown", editorPress);
	});
});
