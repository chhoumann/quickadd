import { describe, it, expect, beforeEach } from "vitest";
import { 
	insertAtCursor, 
	replaceRange, 
	getTextBeforeCursor, 
	renderExactHighlight, 
	renderFuzzyHighlight,
	stripMdExtensionForDisplay,
} from "./utils";

// Mock HTMLInputElement for testing
class MockInput {
	value = "";
	selectionStart = 0;
	selectionEnd = 0;
	
	setSelectionRange(start: number, end: number) {
		this.selectionStart = start;
		this.selectionEnd = end;
	}
	
	trigger() {
		// Mock trigger method
	}
	
	dispatchEvent() {
		// Required by replaceRange but not tested
	}
}

describe("Suggester Utils", () => {
	let mockInput: MockInput;

	beforeEach(() => {
		mockInput = new MockInput();
	});

	describe("insertAtCursor", () => {
		it("should insert text at cursor position", () => {
			mockInput.value = "Hello World";
			mockInput.selectionStart = 5;
			mockInput.selectionEnd = 5;

			insertAtCursor(mockInput as any, " Beautiful");

			expect(mockInput.value).toBe("Hello Beautiful World");
			expect(mockInput.selectionStart).toBe(15);
		});

		it("should replace selected text", () => {
			mockInput.value = "Hello World";
			mockInput.selectionStart = 6;
			mockInput.selectionEnd = 11;

			insertAtCursor(mockInput as any, "Universe");

			expect(mockInput.value).toBe("Hello Universe");
			expect(mockInput.selectionStart).toBe(14);
		});
	});

	describe("replaceRange", () => {
		it("should replace text in specified range", () => {
			mockInput.value = "Hello World";

			replaceRange(mockInput as any, 6, 11, "Universe");

			expect(mockInput.value).toBe("Hello Universe");
			expect(mockInput.selectionStart).toBe(14);
		});
	});

	describe("getTextBeforeCursor", () => {
		it("should return text before cursor", () => {
			mockInput.value = "Hello Beautiful World";
			mockInput.selectionStart = 15;

			const result = getTextBeforeCursor(mockInput as any);

			expect(result).toBe("Hello Beautiful");
		});

		it("should respect lookbehind limit", () => {
			mockInput.value = "Hello Beautiful World";
			mockInput.selectionStart = 15;

			const result = getTextBeforeCursor(mockInput as any, 5);

			expect(result).toBe("tiful");
		});
	});

	describe("renderExactHighlight", () => {
		it("should highlight exact matches", () => {
			const el = document.createElement("div");
			renderExactHighlight(el, "Hello World", "World");
			expect(el.innerHTML).toBe('Hello <mark class="qa-highlight">World</mark>');
		});

		it("should be case-insensitive", () => {
			const el = document.createElement("div");
			renderExactHighlight(el, "Hello World", "world");
			expect(el.innerHTML).toBe('Hello <mark class="qa-highlight">World</mark>');
		});

		it("should return original text when no query", () => {
			const el = document.createElement("div");
			renderExactHighlight(el, "Hello World", "");
			expect(el.textContent).toBe("Hello World");
		});

		it("should handle XSS attempts safely", () => {
			const el = document.createElement("div");
			renderExactHighlight(el, "<script>alert(1)</script>", "alert");
			expect(el.textContent).toContain("<script>");
			expect(el.innerHTML).toContain("&lt;script&gt;");
		});

		it("should handle HTML entities correctly", () => {
			const el = document.createElement("div");
			renderExactHighlight(el, "R&D", "&");
			expect(el.textContent).toBe("R&D");
		});

		// Regression: U+0130 'İ' lowercases to 'i' + combining dot (two UTF-16
		// code units), so a match found in the lowercased text lands one code
		// unit past where it sits in the original string. The mark must still
		// wrap the original "Hello", not the shifted "ello".
		it("aligns the mark after a length-changing lowercase (U+0130)", () => {
			const el = document.createElement("div");
			renderExactHighlight(el, "İHello", "hello");
			expect(el.innerHTML).toBe(
				'İ<mark class="qa-highlight">Hello</mark>',
			);
			expect(el.textContent).toBe("İHello");
		});

		// Two matches after the same length-changing character: every slice
		// boundary (pre-text, marks, gaps) must stay aligned through the loop.
		it("keeps multiple matches aligned after U+0130", () => {
			const el = document.createElement("div");
			renderExactHighlight(el, "İa-a", "a");
			expect(el.innerHTML).toBe(
				'İ<mark class="qa-highlight">a</mark>-<mark class="qa-highlight">a</mark>',
			);
			expect(el.textContent).toBe("İa-a");
		});

		// Typing 'i' matches the 'i' that 'İ' lowercases into; the mark must wrap
		// the whole 'İ' grapheme, never collapse into an empty <mark></mark>.
		it("wraps the whole grapheme when the query matches inside a U+0130 expansion", () => {
			const el = document.createElement("div");
			renderExactHighlight(el, "İstanbul", "i");
			expect(el.innerHTML).toBe(
				'<mark class="qa-highlight">İ</mark>stanbul',
			);
			expect(el.textContent).toBe("İstanbul");
		});

		it("highlights both a plain and a decomposing match without an empty mark", () => {
			const el = document.createElement("div");
			renderExactHighlight(el, "Diary İstanbul", "i");
			expect(el.innerHTML).toBe(
				'D<mark class="qa-highlight">i</mark>ary <mark class="qa-highlight">İ</mark>stanbul',
			);
			expect(el.textContent).toBe("Diary İstanbul");
		});

		// Whole-string toLowerCase folds a word-final Σ to ς ("ΣΣ" -> "σς"), which
		// disagrees with per-character lowercasing of the text; the query must be
		// folded the same way so an exact match still highlights.
		it("highlights a Greek capital-sigma match (symmetric case folding)", () => {
			const el = document.createElement("div");
			renderExactHighlight(el, "ΣΣ", "ΣΣ");
			expect(el.innerHTML).toBe('<mark class="qa-highlight">ΣΣ</mark>');
			expect(el.textContent).toBe("ΣΣ");
		});

		it("never emits an empty <mark> for length-changing lowercase inputs", () => {
			for (const [text, query] of [
				["İ", "i"],
				["İİ", "i"],
				["aİb", "i"],
				["İstanbul", "ı"],
				["İHi", "i"],
			] as const) {
				const el = document.createElement("div");
				renderExactHighlight(el, text, query);
				// No degenerate empty highlight spans, and no characters lost.
				for (const mark of Array.from(el.querySelectorAll("mark"))) {
					expect(mark.textContent).not.toBe("");
				}
				expect(el.textContent).toBe(text);
			}
		});
	});

	describe("renderFuzzyHighlight", () => {
		it("should highlight individual matching characters", () => {
			const el = document.createElement("div");
			renderFuzzyHighlight(el, "Hello World", "HW");
			expect(el.innerHTML).toBe('<mark class="qa-highlight">H</mark>ello <mark class="qa-highlight">W</mark>orld');
		});

		it("should be case-insensitive", () => {
			const el = document.createElement("div");
			renderFuzzyHighlight(el, "Hello World", "hw");
			expect(el.innerHTML).toBe('<mark class="qa-highlight">H</mark>ello <mark class="qa-highlight">W</mark>orld');
		});

		it("should return original text when no query", () => {
			const el = document.createElement("div");
			renderFuzzyHighlight(el, "Hello World", "");
			expect(el.textContent).toBe("Hello World");
		});

		it("should handle HTML entities correctly", () => {
			const el = document.createElement("div");
			renderFuzzyHighlight(el, "R&D", "&");
			expect(el.textContent).toBe("R&D");
			expect(el.innerHTML).toBe('R<mark class="qa-highlight">&amp;</mark>D');
		});

		it("should handle XSS attempts safely", () => {
			const el = document.createElement("div");
			renderFuzzyHighlight(el, "<img src=x>", "i");
			expect(el.textContent).toContain("<img");
			expect(el.innerHTML).toBe('&lt;<mark class="qa-highlight">i</mark>mg src=x&gt;');
		});
	});

	describe("stripMdExtensionForDisplay", () => {
		it("strips only a trailing .md extension (case-insensitive)", () => {
			expect(stripMdExtensionForDisplay("file.md")).toBe("file");
			expect(stripMdExtensionForDisplay("folder/file.md")).toBe("folder/file");
			expect(stripMdExtensionForDisplay("FILE.MD")).toBe("FILE");
		});

		it("does not strip other extensions", () => {
			expect(stripMdExtensionForDisplay("file.js")).toBe("file.js");
			expect(stripMdExtensionForDisplay("file.canvas")).toBe("file.canvas");
		});

		it("does not strip .md when it is not the final suffix", () => {
			expect(stripMdExtensionForDisplay("file.md.backup")).toBe(
				"file.md.backup",
			);
			expect(stripMdExtensionForDisplay("file.md.md")).toBe("file.md");
			expect(stripMdExtensionForDisplay("{{TEMPLATE:folder/file.md}}")).toBe(
				"{{TEMPLATE:folder/file.md}}",
			);
		});
	});
});
