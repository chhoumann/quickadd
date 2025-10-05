import { describe, it, expect, beforeEach } from "vitest";

// Test helper to access the private escapeBackslashes method
class TestableGenericWideInputPrompt {
	escapeBackslashes(input: string): string {
		return input.replace(/\\/g, "\\\\");
	}
}

describe("GenericWideInputPrompt - Escape Backslashes", () => {
	let prompt: TestableGenericWideInputPrompt;

	beforeEach(() => {
		prompt = new TestableGenericWideInputPrompt();
	});

	describe("Basic escape sequences", () => {
		it("should escape single backslash-n sequence", () => {
			const input = 'let str = "aa\\nbb";';
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe('let str = "aa\\\\nbb";');
		});

		it("should escape multiple backslash-n sequences", () => {
			const input = "Line1\\nLine2\\nLine3";
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe("Line1\\\\nLine2\\\\nLine3");
		});

		it("should escape backslash-t sequences", () => {
			const input = "Column1\\tColumn2";
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe("Column1\\\\tColumn2");
		});

		it("should handle text without backslashes", () => {
			const input = "No escapes here";
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe("No escapes here");
		});
	});

	describe("Already escaped backslashes", () => {
		it("should double-escape already escaped backslashes", () => {
			const input = "Path\\\\to\\\\file";
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe("Path\\\\\\\\to\\\\\\\\file");
		});

		it("should handle mixed escape patterns", () => {
			const input = "Line1\\nLine2\\\\nLine3";
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe("Line1\\\\nLine2\\\\\\\\nLine3");
		});
	});

	describe("Real-world code examples", () => {
		it("should preserve JavaScript string escape sequences", () => {
			const input = `function test() {
  let str = "aa\\nbb";
  return str;
}`;
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe(`function test() {
  let str = "aa\\\\nbb";
  return str;
}`);
		});

		it("should preserve regex patterns with backslashes", () => {
			const input = "const regex = /\\d+\\s+\\w+/;";
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe("const regex = /\\\\d+\\\\s+\\\\w+/;");
		});

		it("should preserve path separators", () => {
			const input = "C:\\Users\\Documents\\file.txt";
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe("C:\\\\Users\\\\Documents\\\\file.txt");
		});
	});

	describe("Edge cases", () => {
		it("should handle empty string", () => {
			const input = "";
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe("");
		});

		it("should handle single backslash", () => {
			const input = "\\";
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe("\\\\");
		});

		it("should handle trailing backslash", () => {
			const input = "Some text\\";
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe("Some text\\\\");
		});

		it("should not affect actual newlines", () => {
			const input = "Line1\nLine2\nLine3";
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe("Line1\nLine2\nLine3");
		});
	});

	describe("Issue #799 test case", () => {
		it("should preserve backslash-n in JavaScript code from issue", () => {
			const input = `let str = "aa\\nbb";
let d = 1;`;
			const result = prompt.escapeBackslashes(input);
			expect(result).toBe(`let str = "aa\\\\nbb";
let d = 1;`);
		});
	});
});
