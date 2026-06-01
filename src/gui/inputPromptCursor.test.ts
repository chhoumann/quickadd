import { describe, expect, it } from "vitest";
import { positionInputPromptCursor } from "./inputPromptCursor";

describe("positionInputPromptCursor", () => {
	it("selects the default input value unless options request cursor placement", () => {
		const inputEl = document.createElement("input");
		inputEl.value = "#";
		document.body.appendChild(inputEl);

		positionInputPromptCursor(inputEl);

		expect(inputEl.selectionStart).toBe(0);
		expect(inputEl.selectionEnd).toBe(1);

		inputEl.remove();
	});

	it("places the input cursor at the end when cursorAtEnd is true", () => {
		const inputEl = document.createElement("input");
		inputEl.value = "#tag";
		document.body.appendChild(inputEl);

		positionInputPromptCursor(inputEl, { cursorAtEnd: true });

		expect(inputEl.selectionStart).toBe(4);
		expect(inputEl.selectionEnd).toBe(4);

		inputEl.remove();
	});

	it("places the textarea cursor at the end when cursorAtEnd is true", () => {
		const inputEl = document.createElement("textarea");
		inputEl.value = "line one\nline two";
		document.body.appendChild(inputEl);

		positionInputPromptCursor(inputEl, { cursorAtEnd: true });

		expect(inputEl.selectionStart).toBe(inputEl.value.length);
		expect(inputEl.selectionEnd).toBe(inputEl.value.length);

		inputEl.remove();
	});
});
