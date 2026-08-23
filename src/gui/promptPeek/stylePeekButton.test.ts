import { describe, expect, it } from "vitest";
import { ButtonComponent } from "obsidian";
import {
	PEEK_BUTTON_LABEL,
	PEEK_BUTTON_LABEL_COMPACT,
	stylePeekButton,
} from "./stylePeekButton";

describe("stylePeekButton", () => {
	it("keeps the visible label next to the icon", () => {
		const host = document.createElement("div");
		const button = stylePeekButton(new ButtonComponent(host));

		expect(button.buttonEl.classList.contains("qa-peek-button")).toBe(true);
		expect(button.buttonEl.textContent).toContain(PEEK_BUTTON_LABEL);
		expect(button.buttonEl.querySelector(".qa-peek-button-icon")).not.toBeNull();
		expect(button.buttonEl.getAttribute("aria-label")).toBe(
			"Peek at the note. Your draft stays.",
		);
	});

	it("shortens the label on a phone-width window", () => {
		const originalWidth = window.innerWidth;
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: 390,
		});
		try {
			const host = document.createElement("div");
			const button = stylePeekButton(new ButtonComponent(host));
			expect(button.buttonEl.textContent).toContain(PEEK_BUTTON_LABEL_COMPACT);
			expect(button.buttonEl.textContent).not.toContain(PEEK_BUTTON_LABEL);
		} finally {
			Object.defineProperty(window, "innerWidth", {
				configurable: true,
				value: originalWidth,
			});
		}
	});
});
