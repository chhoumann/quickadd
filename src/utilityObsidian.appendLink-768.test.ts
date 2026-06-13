import { MarkdownView, type App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __test, insertLinkWithPlacement } from "./utilityObsidian";

const { getFocusedEditablePropertyEl, insertTextIntoEditableEl } = __test;

/**
 * Regression tests for #768: with the caret in a frontmatter property field the
 * link used to land at the first body line; the fix routes it to the property.
 */

afterEach(() => {
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

/** Builds a fake App whose active MarkdownView records editor mutations. */
function makeApp() {
	const calls = { replaceSelection: [] as string[], replaceRange: [] as unknown[] };
	const editor = {
		listSelections: () => [
			{ anchor: { line: 3, ch: 0 }, head: { line: 3, ch: 0 } },
		],
		getCursor: () => ({ line: 3, ch: 0 }),
		getLine: () => "",
		posToOffset: ({ line, ch }: { line: number; ch: number }) => line * 100 + ch,
		replaceSelection: (text: string) => calls.replaceSelection.push(text),
		replaceRange: (...args: unknown[]) => calls.replaceRange.push(args),
		setCursor: () => {},
	};
	const view = { editor } as unknown as MarkdownView;
	const app = {
		workspace: {
			getActiveViewOfType: (ctor: unknown) =>
				ctor === MarkdownView ? view : null,
		},
	} as unknown as App;
	return { app, calls };
}

/** Mounts an Obsidian-like Properties widget with one focused text property. */
function mountFocusedTextProperty(initialValue = ""): HTMLInputElement {
	const container = document.createElement("div");
	container.className = "metadata-properties-container";
	const row = document.createElement("div");
	row.className = "metadata-property";
	const input = document.createElement("input");
	input.type = "text";
	input.value = initialValue;
	row.appendChild(input);
	container.appendChild(row);
	document.body.appendChild(container);
	input.focus();
	const caret = initialValue.length;
	input.setSelectionRange(caret, caret);
	return input;
}

describe("getFocusedEditablePropertyEl", () => {
	it("returns the focused input when it's inside the Properties widget", () => {
		const input = mountFocusedTextProperty("status: ");
		expect(getFocusedEditablePropertyEl()).toBe(input);
	});

	it("returns null when the focused element is outside the Properties widget", () => {
		const input = document.createElement("input");
		document.body.appendChild(input);
		input.focus();
		expect(getFocusedEditablePropertyEl()).toBeNull();
	});

	it("returns null when nothing relevant is focused", () => {
		expect(getFocusedEditablePropertyEl()).toBeNull();
	});
});

describe("insertTextIntoEditableEl", () => {
	it("inserts at the caret of an input and fires an input event", () => {
		const input = mountFocusedTextProperty("ab");
		input.setSelectionRange(1, 1); // caret between 'a' and 'b'
		const onInput = vi.fn();
		input.addEventListener("input", onInput);

		const ok = insertTextIntoEditableEl(input, "[[X]]");

		expect(ok).toBe(true);
		expect(input.value).toBe("a[[X]]b");
		expect(onInput).toHaveBeenCalledOnce();
	});

	it("returns false for a non-editable element", () => {
		const div = document.createElement("div");
		expect(insertTextIntoEditableEl(div, "[[X]]")).toBe(false);
	});
});

describe("insertLinkWithPlacement (#768 property-field routing)", () => {
	it("inserts into the focused property field, not the body editor", () => {
		const input = mountFocusedTextProperty("links: ");
		const { app, calls } = makeApp();

		insertLinkWithPlacement(app, "[[Created Note]]", "replaceSelection");

		expect(input.value).toBe("links: [[Created Note]]");
		// The body editor must be left untouched.
		expect(calls.replaceSelection).toHaveLength(0);
		expect(calls.replaceRange).toHaveLength(0);
	});

	it("still uses the body editor when no property field is focused", () => {
		const { app, calls } = makeApp();

		insertLinkWithPlacement(app, "[[Created Note]]", "replaceSelection");

		expect(calls.replaceSelection).toEqual(["[[Created Note]]"]);
	});
});
