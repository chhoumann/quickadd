import { describe, it, expect, beforeEach } from "vitest";
import {
	computeIndentEdit,
	applyIndentEdit,
	attachTextareaIndent,
} from "./textareaIndent";

const TAB = "\t";

/** Apply a computed edit to a plain string the same way the DOM applier does. */
function applyToString(value: string, selStart: number, selEnd: number): string {
	const edit = computeIndentEdit(value, selStart, selEnd);
	return (
		value.slice(0, edit.regionStart) +
		edit.replacement +
		value.slice(edit.regionEnd)
	);
}

describe("computeIndentEdit", () => {
	describe("collapsed caret — insert a tab", () => {
		it("inserts at the caret in the middle of a line", () => {
			const edit = computeIndentEdit("alpha", 2, 2);
			expect(edit.replacement).toBe(TAB);
			expect(edit.regionStart).toBe(2);
			expect(edit.regionEnd).toBe(2);
			expect(edit.selectionStart).toBe(3);
			expect(edit.selectionEnd).toBe(3);
			expect(applyToString("alpha", 2, 2)).toBe("al\tpha");
		});

		it("inserts at the start (caret 0)", () => {
			expect(applyToString("alpha", 0, 0)).toBe("\talpha");
		});

		it("inserts at the end", () => {
			expect(applyToString("alpha", 5, 5)).toBe("alpha\t");
		});

		it("inserts into an empty value", () => {
			const edit = computeIndentEdit("", 0, 0);
			expect(edit.replacement).toBe(TAB);
			expect(applyToString("", 0, 0)).toBe("\t");
		});

		it("honours a custom tab string", () => {
			const edit = computeIndentEdit("ab", 1, 1, { tab: "  " });
			expect(edit.replacement).toBe("  ");
			expect(edit.selectionStart).toBe(3);
		});
	});

	describe("selection — block-indent, never destroy", () => {
		it("indents a single fully-selected line instead of replacing it", () => {
			// The wide prompt opens with the whole value selected; the first Tab
			// must not wipe it.
			expect(applyToString("alpha", 0, 5)).toBe("\talpha");
		});

		it("indents a within-line selection's line (no data loss)", () => {
			expect(applyToString("alpha", 1, 3)).toBe("\talpha");
		});

		it("indents every line of a multi-line selection", () => {
			expect(applyToString("a\nb\nc", 0, 5)).toBe("\ta\n\tb\n\tc");
		});

		it("indents from the start of the first touched line even if selection starts mid-line", () => {
			// value: "a\nbcd", select "cd" (indices 3..5) -> still indents the whole "bcd" line
			expect(applyToString("a\nbcd", 3, 5)).toBe("a\n\tbcd");
		});

		it("does NOT indent the next line when the selection ends on a newline", () => {
			// select "a\n" (indices 0..2) in "a\nb" -> only line "a" is indented
			expect(applyToString("a\nb", 0, 2)).toBe("\ta\nb");
		});

		it("does NOT indent the trailing unselected line for a multi-line selection ending at a line start", () => {
			// select "a\nb\n" (0..4) in "a\nb\nc" -> indent a and b, not c
			expect(applyToString("a\nb\nc", 0, 4)).toBe("\ta\n\tb\nc");
		});

		it("indents interior blank lines but not a trailing empty segment", () => {
			expect(applyToString("a\n\nb", 0, 4)).toBe("\ta\n\t\n\tb");
		});

		it("indents the leading line when the value starts with a newline (selStart 0)", () => {
			// Regression: lastIndexOf("\n", -1) clamps to 0 and would match the
			// leading newline, dropping the first (blank) line from the region.
			expect(applyToString("\nabc", 0, 4)).toBe("\t\n\tabc");
		});

		it("handles selecting only a leading newline", () => {
			const edit = computeIndentEdit("\nabc", 0, 1);
			expect(edit.regionStart).toBe(0);
			expect(applyToString("\nabc", 0, 1)).toBe("\t\nabc");
		});

		it("treats CRLF \\r as an ordinary character (offsets stay aligned)", () => {
			// "a\r\nb": select all (0..4). lastIndexOf finds the \n; \r rides along on its line.
			expect(applyToString("a\r\nb", 0, 4)).toBe("\ta\r\n\tb");
		});

		it("shifts the selection to cover the same text after indenting", () => {
			const edit = computeIndentEdit("a\nb", 0, 3); // select "a\nb"
			expect(edit.regionStart).toBe(0);
			expect(edit.regionEnd).toBe(3);
			expect(edit.replacement).toBe("\ta\n\tb");
			expect(edit.selectionStart).toBe(1); // 0 + one tab
			expect(edit.selectionEnd).toBe(5); // 3 + two tabs
		});
	});
});

describe("applyIndentEdit (jsdom fallback path)", () => {
	let textarea: HTMLTextAreaElement;

	beforeEach(() => {
		textarea = document.createElement("textarea");
		document.body.appendChild(textarea);
	});

	it("inserts the tab and fires an input event (keeps onChange in sync)", () => {
		textarea.value = "alpha";
		textarea.setSelectionRange(2, 2);
		let inputFired = 0;
		textarea.addEventListener("input", () => inputFired++);

		applyIndentEdit(textarea, computeIndentEdit("alpha", 2, 2));

		expect(textarea.value).toBe("al\tpha");
		expect(inputFired).toBe(1);
		expect(textarea.selectionStart).toBe(3);
		expect(textarea.selectionEnd).toBe(3);
	});

	it("block-indents a selection without destroying it", () => {
		textarea.value = "a\nb";
		textarea.setSelectionRange(0, 3);
		applyIndentEdit(textarea, computeIndentEdit("a\nb", 0, 3));
		expect(textarea.value).toBe("\ta\n\tb");
	});
});

describe("attachTextareaIndent", () => {
	let textarea: HTMLTextAreaElement;
	let dispose: () => void;

	function dispatch(opts: Partial<KeyboardEventInit>) {
		const evt = new KeyboardEvent("keydown", {
			bubbles: true,
			cancelable: true,
			...opts,
		});
		textarea.dispatchEvent(evt);
		return evt;
	}

	const pressTab = (opts: Partial<KeyboardEventInit> = {}) =>
		dispatch({ key: "Tab", ...opts });

	beforeEach(() => {
		textarea = document.createElement("textarea");
		document.body.appendChild(textarea);
		dispose = attachTextareaIndent(textarea);
	});

	it("inserts a tab on plain Tab and prevents default", () => {
		textarea.value = "alpha";
		textarea.setSelectionRange(5, 5);
		const evt = pressTab();
		expect(evt.defaultPrevented).toBe(true);
		expect(textarea.value).toBe("alpha\t");
	});

	it("ignores Shift+Tab so focus navigation still works", () => {
		textarea.value = "alpha";
		textarea.setSelectionRange(5, 5);
		const evt = pressTab({ shiftKey: true });
		expect(evt.defaultPrevented).toBe(false);
		expect(textarea.value).toBe("alpha");
	});

	it.each([
		["ctrlKey", { ctrlKey: true }],
		["metaKey", { metaKey: true }],
		["altKey", { altKey: true }],
	])("ignores Tab with %s held", (_label, mods) => {
		textarea.value = "x";
		textarea.setSelectionRange(1, 1);
		const evt = pressTab(mods);
		expect(evt.defaultPrevented).toBe(false);
		expect(textarea.value).toBe("x");
	});

	it("ignores non-Tab keys", () => {
		textarea.value = "x";
		textarea.setSelectionRange(1, 1);
		const evt = dispatch({ key: "a" });
		expect(evt.defaultPrevented).toBe(false);
		expect(textarea.value).toBe("x");
	});

	it("stops inserting after the disposer runs (idempotent)", () => {
		textarea.value = "x";
		textarea.setSelectionRange(1, 1);
		dispose();
		dispose(); // idempotent — must not throw
		const evt = pressTab();
		expect(evt.defaultPrevented).toBe(false);
		expect(textarea.value).toBe("x");
	});
});
