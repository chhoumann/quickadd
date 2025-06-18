import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create a test implementation of the abstract Formatter class
class TestFormatter {
    protected variables: Map<string, unknown> = new Map();

    protected getVariableValue(variableName: string): string {
        // This is the fix we're testing
        return (this.variables.get(variableName) as string) ?? "";
    }

    protected replaceLinebreakInString(input: string): string {
        let output = "";

        for (let i = 0; i < input.length; i++) {
            const curr = input[i];
            const next = input[i + 1];

            if (curr == "\\") {
                if (next == "n") {
                    output += "\n";
                    i++;
                } else if (next == "\\") {
                    output += "\\";
                    i++;
                } else {
                    // Invalid use of escape character, but we keep it anyway.
                    output += '\\';
                }
            } else {
                output += curr;
            }
        }

        return output;
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
        it('should replace \\n with actual newline', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\nLine2");
            expect(result).toBe("Line1\nLine2");
        });

        it('should replace multiple \\n sequences', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\n\\nLine2");
            expect(result).toBe("Line1\n\nLine2");
        });

        it('should handle text without escape sequences', () => {
            const result = formatter.testReplaceLinebreakInString("No escapes here");
            expect(result).toBe("No escapes here");
        });

        it('should handle empty string', () => {
            const result = formatter.testReplaceLinebreakInString("");
            expect(result).toBe("");
        });
    });

    describe('Escape sequence handling', () => {
        it('should replace \\\\ with single backslash', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\\\Line2");
            expect(result).toBe("Line1\\Line2");
        });

        it('should handle mixed escape sequences', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\nLine2\\\\Line3");
            expect(result).toBe("Line1\nLine2\\Line3");
        });

        it('should handle invalid escape sequences', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\tLine2");
            expect(result).toBe("Line1\\tLine2");
        });

        it('should handle trailing backslash', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\");
            expect(result).toBe("Line1\\");
        });
    });

    describe('Complex escape sequences', () => {
        it('should handle \\\\n as escaped backslash followed by n', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\\\nLine2");
            expect(result).toBe("Line1\\nLine2");
        });

        it('should handle \\\\\\n as escaped backslash followed by newline', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\\\\\nLine2");
            expect(result).toBe("Line1\\\nLine2");
        });

        it('should handle multiple consecutive backslashes', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\\\\\\\Line2");
            expect(result).toBe("Line1\\\\Line2");
        });
    });

    describe('Test cases from PR description', () => {
        it('should handle "Line1\\\\Line2"', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\\\Line2");
            expect(result).toBe("Line1\\Line2");
        });

        it('should handle "Line1\\\\\\\\Line2"', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\\\\\\\Line2");
            expect(result).toBe("Line1\\\\Line2");
        });

        it('should handle "Line1\\tLine2"', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\tLine2");
            expect(result).toBe("Line1\\tLine2");
        });

        it('should handle "Line1\\nLine2"', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\nLine2");
            expect(result).toBe("Line1\nLine2");
        });

        it('should handle "Line1\\n\\nLine2"', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\n\\nLine2");
            expect(result).toBe("Line1\n\nLine2");
        });

        it('should handle "Line1\\n\\\\nLine2"', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\n\\\\nLine2");
            expect(result).toBe("Line1\n\\nLine2");
        });

        it('should handle "Line1\\n\\\\\\\\nLine2"', () => {
            const result = formatter.testReplaceLinebreakInString("Line1\\n\\\\\\nLine2");
            expect(result).toBe("Line1\n\\\nLine2");
        });
    });
});