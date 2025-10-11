import { describe, it, expect, beforeEach } from "vitest";
import { 
	insertAtCursor, 
	replaceRange, 
	getTextBeforeCursor, 
	renderExactHighlight, 
	renderFuzzyHighlight 
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
});
