import { StubFormatter } from "../../tests/helpers/formatters/stubFormatter";
import { describe, it, expect, beforeEach } from 'vitest';

// Exposes the base Formatter's real linebreak expansion.
class TestFormatter extends StubFormatter {
	public testReplaceLinebreakInString(input: string): string {
		return this.expandLinebreakEscapesOutsideTokens(input);
	}
}

describe('Formatter - expandLinebreakEscapesOutsideTokens', () => {
    let formatter: TestFormatter;

    beforeEach(() => {
        formatter = new TestFormatter();
    });

    describe('Basic linebreak replacement', () => {
        it.each([
	{ name: 'should replace \\n with actual newline', input: "Line1\\nLine2", expected: "Line1\nLine2" },
	{ name: 'should replace multiple \\n sequences', input: "Line1\\n\\nLine2", expected: "Line1\n\nLine2" },
	{ name: 'should handle text without escape sequences', input: "No escapes here", expected: "No escapes here" },
	{ name: 'should handle empty string', input: "", expected: "" },
        ])("$name", ({ input, expected }) => {
            const result = formatter.testReplaceLinebreakInString(input);
            expect(result).toBe(expected);
        });
    });

    describe('Escape sequence handling', () => {
        it.each([
	{ name: 'should replace \\\\ with single backslash', input: "Line1\\\\Line2", expected: "Line1\\Line2" },
	{ name: 'should handle mixed escape sequences', input: "Line1\\nLine2\\\\Line3", expected: "Line1\nLine2\\Line3" },
	{ name: 'should handle invalid escape sequences', input: "Line1\\tLine2", expected: "Line1\\tLine2" },
	{ name: 'should handle trailing backslash', input: "Line1\\", expected: "Line1\\" },
        ])("$name", ({ input, expected }) => {
            const result = formatter.testReplaceLinebreakInString(input);
            expect(result).toBe(expected);
        });
    });

    describe('Complex escape sequences', () => {
        it.each([
	{ name: 'should handle \\\\n as escaped backslash followed by n', input: "Line1\\\\nLine2", expected: "Line1\\nLine2" },
	{ name: 'should handle \\\\\\n as escaped backslash followed by newline', input: "Line1\\\\\\nLine2", expected: "Line1\\\nLine2" },
	{ name: 'should handle multiple consecutive backslashes', input: "Line1\\\\\\\\Line2", expected: "Line1\\\\Line2" },
	{ name: 'should expand \\n after an escaped backslash-n', input: "Line1\\n\\\\nLine2", expected: "Line1\n\\nLine2" },
	{ name: 'should expand \\n after an escaped backslash-newline', input: "Line1\\n\\\\\\nLine2", expected: "Line1\n\\\nLine2" },
        ])("$name", ({ input, expected }) => {
            const result = formatter.testReplaceLinebreakInString(input);
            expect(result).toBe(expected);
        });
    });
});
