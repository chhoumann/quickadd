import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create a test implementation of the abstract Formatter class
class TestFormatter {
    protected variables: Map<string, unknown> = new Map();

    protected getVariableValue(variableName: string): string {
        // This is the fix we're testing
        return (this.variables.get(variableName) as string) ?? "";
    }

    // Expose for testing
    public testGetVariableValue(variableName: string): string {
        return this.getVariableValue(variableName);
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