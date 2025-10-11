import { describe, it, expect, beforeEach } from "vitest";
import { 
	insertAtCursor, 
	replaceRange, 
	getTextBeforeCursor, 
	highlightMatches, 
	highlightFuzzyMatches 
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

	describe("highlightMatches", () => {
		it("should highlight exact matches", () => {
			const result = highlightMatches("Hello World", "World");
			expect(result).toBe('Hello <mark class="qa-highlight">World</mark>');
		});

		it("should be case-insensitive", () => {
			const result = highlightMatches("Hello World", "world");
			expect(result).toBe('Hello <mark class="qa-highlight">World</mark>');
		});

		it("should return original text when no query", () => {
			const result = highlightMatches("Hello World", "");
			expect(result).toBe("Hello World");
		});
	});

	describe("highlightFuzzyMatches", () => {
		it("should highlight individual matching characters", () => {
			const result = highlightFuzzyMatches("Hello World", "HW");
			expect(result).toBe('<mark class="qa-highlight">H</mark>ello <mark class="qa-highlight">W</mark>orld');
		});

		it("should be case-insensitive", () => {
			const result = highlightFuzzyMatches("Hello World", "hw");
			expect(result).toBe('<mark class="qa-highlight">H</mark>ello <mark class="qa-highlight">W</mark>orld');
		});

		it("should return original text when no query", () => {
			const result = highlightFuzzyMatches("Hello World", "");
			expect(result).toBe("Hello World");
		});
	});
});
