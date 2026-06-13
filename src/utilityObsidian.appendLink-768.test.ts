import { MarkdownView, type App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __test, insertLinkWithPlacement } from "./utilityObsidian";

const { tryInsertIntoFocusedProperty, insertTextAtCaret } = __test;

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
	const calls = {
		replaceSelection: [] as string[],
		replaceRange: [] as unknown[],
	};
	const editor = {
		listSelections: () => [
			{ anchor: { line: 3, ch: 0 }, head: { line: 3, ch: 0 } },
		],
		getCursor: () => ({ line: 3, ch: 0 }),
		getLine: () => "",
		posToOffset: ({ line, ch }: { line: number; ch: number }) =>
			line * 100 + ch,
		replaceSelection: (text: string) => calls.replaceSelection.push(text),
		replaceRange: (...args: unknown[]) => calls.replaceRange.push(args),
		setCursor: () => {},
	};
	const view = { editor } as unknown as MarkdownView;
	const fakeApp = {
		workspace: {
			getActiveViewOfType: (constructor: unknown) =>
				constructor === MarkdownView ? view : null,
		},
	} as unknown as App;
	return { fakeApp, calls };
}

/** Mounts an Obsidian-like Properties widget with one focused text property. */
function mountFocusedTextProperty(initialValue = ""): HTMLInputElement {
	const container = document.createElement("div");
	container.className = "metadata-properties-container";
	const propertyRow = document.createElement("div");
	propertyRow.className = "metadata-property";
	const input = document.createElement("input");
	input.type = "text";
	input.value = initialValue;
	propertyRow.appendChild(input);
	container.appendChild(propertyRow);
	document.body.appendChild(container);
	input.focus();
	const caret = initialValue.length;
	input.setSelectionRange(caret, caret);
	return input;
}

describe("tryInsertIntoFocusedProperty", () => {
	it("inserts into a focused property field and returns true", () => {
		const input = mountFocusedTextProperty("status: ");
		const inserted = tryInsertIntoFocusedProperty("[[X]]");
		expect(inserted).toBe(true);
		expect(input.value).toBe("status: [[X]]");
	});

	it("returns false and inserts nothing when focus is outside the widget", () => {
		const stray = document.createElement("input");
		document.body.appendChild(stray);
		stray.focus();
		expect(tryInsertIntoFocusedProperty("[[X]]")).toBe(false);
		expect(stray.value).toBe("");
	});

	it("returns false when nothing relevant is focused", () => {
		expect(tryInsertIntoFocusedProperty("[[X]]")).toBe(false);
	});
});

describe("insertTextAtCaret", () => {
	it("inserts at the caret of an input and fires an input event", () => {
		const input = mountFocusedTextProperty("ab");
		input.setSelectionRange(1, 1); // caret between 'a' and 'b'
		const onInput = vi.fn();
		input.addEventListener("input", onInput);

		const inserted = insertTextAtCaret(input, "[[X]]");

		expect(inserted).toBe(true);
		expect(input.value).toBe("a[[X]]b");
		expect(onInput).toHaveBeenCalledOnce();
	});

	it("returns false for a non-editable element", () => {
		const plainDiv = document.createElement("div");
		expect(insertTextAtCaret(plainDiv, "[[X]]")).toBe(false);
	});
});

describe("insertLinkWithPlacement (#768 property-field routing)", () => {
	it("inserts into the focused property field, not the body editor", () => {
		const input = mountFocusedTextProperty("links: ");
		const { fakeApp, calls } = makeApp();

		insertLinkWithPlacement(fakeApp, "[[Created Note]]", "replaceSelection");

		expect(input.value).toBe("links: [[Created Note]]");
		// The body editor must be left untouched.
		expect(calls.replaceSelection).toHaveLength(0);
		expect(calls.replaceRange).toHaveLength(0);
	});

	it("still uses the body editor when no property field is focused", () => {
		const { fakeApp, calls } = makeApp();

		insertLinkWithPlacement(fakeApp, "[[Created Note]]", "replaceSelection");

		expect(calls.replaceSelection).toEqual(["[[Created Note]]"]);
	});
});
