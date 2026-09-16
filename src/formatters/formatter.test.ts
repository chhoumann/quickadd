import { StubFormatter } from "../../tests/helpers/formatters/stubFormatter";
import { describe, it, expect, beforeEach } from 'vitest';

// Create a test implementation of the abstract Formatter class
class TestFormatter extends StubFormatter {
    private promptCalled = false;

    protected getVariableValue(variableName: string): string {
        // This is the fix we're testing
        return (this.variables.get(variableName) as string) ?? "";
    }

    protected async promptForVariable(variableName: string): Promise<string> {
        this.promptCalled = true;
        return "prompted_value";
    }
	public async testReplaceVariableInString(input: string): Promise<string> {
		this.promptCalled = false;
		return this.replaceVariableInString(input);
	}

    // Expose for testing
    public testGetVariableValue(variableName: string): string {
        return this.getVariableValue(variableName);
    }

    public testReplaceLinebreakInString(input: string): string {
        return this.replaceLinebreakInString(input);
    }

    public setVariable(name: string, value: unknown) {
        this.variables.set(name, value);
    }

    public wasPromptCalled(): boolean {
        return this.promptCalled;
    }

    public resetPromptCalled() {
        this.promptCalled = false;
    }
}

describe('Formatter - Variable Handling', () => {
    let formatter: TestFormatter;

    beforeEach(() => {
        formatter = new TestFormatter();
    });

    describe('getVariableValue', () => {
        it('should return empty string for undefined variables', () => {
            formatter.setVariable('testVar', undefined);
            const result = formatter.testGetVariableValue('testVar');
            expect(result).toBe("");
        });

        it('should return empty string for non-existent variables', () => {
            const result = formatter.testGetVariableValue('nonExistent');
            expect(result).toBe("");
        });

        it('should return empty string for null variables', () => {
            formatter.setVariable('nullVar', null);
            const result = formatter.testGetVariableValue('nullVar');
            expect(result).toBe("");
        });

        it('should return the actual value for existing string variables', () => {
            formatter.setVariable('stringVar', 'Hello World');
            const result = formatter.testGetVariableValue('stringVar');
            expect(result).toBe("Hello World");
        });

        it('should preserve empty string values', () => {
            formatter.setVariable('emptyVar', '');
            const result = formatter.testGetVariableValue('emptyVar');
            expect(result).toBe("");
        });
    });

    describe('Issue #163 - Empty string variables should not trigger prompts', () => {
        it('should not prompt when variable exists but is empty string', async () => {
            formatter.setVariable('myRating', '');
            const result = await formatter.testReplaceVariableInString('Rating: {{VALUE:myRating}}');
            expect(result).toBe('Rating: ');
            expect(formatter.wasPromptCalled()).toBe(false);
        });

        it('should prompt when variable does not exist', async () => {
            const result = await formatter.testReplaceVariableInString('Rating: {{VALUE:nonExistent}}');
            expect(result).toBe('Rating: prompted_value');
            expect(formatter.wasPromptCalled()).toBe(true);
        });

        it('should prompt when variable is undefined', async () => {
            formatter.setVariable('undefinedVar', undefined);
            const result = await formatter.testReplaceVariableInString('Rating: {{VALUE:undefinedVar}}');
            expect(result).toBe('Rating: prompted_value');
            expect(formatter.wasPromptCalled()).toBe(true);
        });

        it('should not prompt when variable is null', async () => {
            formatter.setVariable('nullVar', null);
            const result = await formatter.testReplaceVariableInString('Rating: {{VALUE:nullVar}}');
            expect(result).toBe('Rating: ');
            expect(formatter.wasPromptCalled()).toBe(false);
        });

        it('should preserve non-empty string values without prompting', async () => {
            formatter.setVariable('ratedMovie', '8/10');
            const result = await formatter.testReplaceVariableInString('Rating: {{VALUE:ratedMovie}}');
            expect(result).toBe('Rating: 8/10');
            expect(formatter.wasPromptCalled()).toBe(false);
        });

        it('should preserve the string "0"', () => {
            formatter.setVariable('zeroString', '0');
            const result = formatter.testGetVariableValue('zeroString');
            expect(result).toBe("0");
        });

        it('should preserve the string "false"', () => {
            formatter.setVariable('falseString', 'false');
            const result = formatter.testGetVariableValue('falseString');
            expect(result).toBe("false");
        });
    });

    describe('Edge cases that caused the bug', () => {
        it('should handle variables set by macros that return undefined', () => {
            // Simulating a macro that doesn't return anything
            const macroResult = undefined;
            formatter.setVariable('macroVar', macroResult);
            
            const result = formatter.testGetVariableValue('macroVar');
            expect(result).toBe("");
            expect(result).not.toBe("undefined");
        });

        it('should handle variables from empty user input', () => {
            // Simulating user pressing Enter without typing anything
            const userInput = "";
            formatter.setVariable('userVar', userInput);
            
            const result = formatter.testGetVariableValue('userVar');
            expect(result).toBe("");
        });

        it('should handle chain of undefined variables', () => {
            // var1 is undefined, var2 gets value from var1
            formatter.setVariable('var1', undefined);
            const var1Value = formatter.testGetVariableValue('var1');
            formatter.setVariable('var2', var1Value);
            
            const result = formatter.testGetVariableValue('var2');
            expect(result).toBe("");
            expect(result).not.toBe("undefined");
        });
    });
});

describe('Formatter - replaceLinebreakInString', () => {
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
        ])("$name", ({ input, expected }) => {
            const result = formatter.testReplaceLinebreakInString(input);
            expect(result).toBe(expected);
        });
    });

    describe('Test cases from PR description', () => {
        it.each([
	{ name: 'should handle "Line1\\\\Line2"', input: "Line1\\\\Line2", expected: "Line1\\Line2" },
	{ name: 'should handle "Line1\\\\\\\\Line2"', input: "Line1\\\\\\\\Line2", expected: "Line1\\\\Line2" },
	{ name: 'should handle "Line1\\tLine2"', input: "Line1\\tLine2", expected: "Line1\\tLine2" },
	{ name: 'should handle "Line1\\nLine2"', input: "Line1\\nLine2", expected: "Line1\nLine2" },
	{ name: 'should handle "Line1\\n\\nLine2"', input: "Line1\\n\\nLine2", expected: "Line1\n\nLine2" },
	{ name: 'should handle "Line1\\n\\\\nLine2"', input: "Line1\\n\\\\nLine2", expected: "Line1\n\\nLine2" },
	{ name: 'should handle "Line1\\n\\\\\\\\nLine2"', input: "Line1\\n\\\\\\nLine2", expected: "Line1\n\\\nLine2" },
        ])("$name", ({ input, expected }) => {
            const result = formatter.testReplaceLinebreakInString(input);
            expect(result).toBe(expected);
        });
    });
});
