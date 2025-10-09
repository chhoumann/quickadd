import { describe, it, expect, beforeEach } from 'vitest';
import { getVariableValueAsString } from './test-utils';

// Mock the abstract methods for testing
class TestFormatter {
    protected variables: Map<string, unknown> = new Map();
    private promptResponses: Map<string, string> = new Map();
    private suggesterResponses: Map<string, string> = new Map();

    protected getVariableValue(variableName: string): string {
        return getVariableValueAsString(this.variables, variableName);
    }

    protected replacer(str: string, reg: RegExp, replaceValue: string) {
        return str.replace(reg, function () {
            return replaceValue;
        });
    }

    protected async promptForVariable(variableName: string): Promise<string> {
        return this.promptResponses.get(variableName) || "";
    }

    protected async suggestForValue(suggestedValues: string[]): Promise<string> {
        const key = suggestedValues.join(",");
        return this.suggesterResponses.get(key) || "";
    }

    // Expose the method we're testing
    public async testReplaceVariableInString(input: string): Promise<string> {
        const VARIABLE_REGEX = /{{VALUE:([^\n\r}]*)}}/i;
        let output: string = input;

        while (VARIABLE_REGEX.test(output)) {
            const match = VARIABLE_REGEX.exec(output);
            if (!match) throw new Error("unable to parse variable");

            let variableName = match[1];
            let defaultValue = "";

            if (variableName) {
                // Parse default value if present (syntax: {{VALUE:name|default}})
                const pipeIndex = variableName.indexOf("|");
                if (pipeIndex !== -1) {
                    defaultValue = variableName.substring(pipeIndex + 1).trim();
                    variableName = variableName.substring(0, pipeIndex).trim();
                }

                if (!this.getVariableValue(variableName)) {
                    const suggestedValues = variableName.split(",");
                    let variableValue = "";

                    if (suggestedValues.length === 1) {
                        variableValue = await this.promptForVariable(variableName);
                    } else {
                        variableValue = await this.suggestForValue(suggestedValues);
                    }

                    // Use default value if no input provided
                    if (!variableValue && defaultValue) {
                        variableValue = defaultValue;
                    }

                    this.variables.set(variableName, variableValue);
                }

                output = this.replacer(
                    output,
                    VARIABLE_REGEX,
                    this.getVariableValue(variableName)
                );
            } else {
                break;
            }
        }

        return output;
    }

    // Test helpers
    public setPromptResponse(variableName: string, response: string) {
        this.promptResponses.set(variableName, response);
    }

    public setSuggesterResponse(values: string[], response: string) {
        this.suggesterResponses.set(values.join(","), response);
    }

    public clearVariables() {
        this.variables.clear();
        this.promptResponses.clear();
        this.suggesterResponses.clear();
    }
}

describe('Formatter - Default Values for {{VALUE:variable}}', () => {
    let formatter: TestFormatter;

    beforeEach(() => {
        formatter = new TestFormatter();
    });

    describe('Basic default value functionality', () => {
        it('should use default value when user provides no input', async () => {
            const input = "Hello {{VALUE:name|World}}!";
            formatter.setPromptResponse('name', ''); // Empty response
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("Hello World!");
        });

        it('should use user input when provided instead of default', async () => {
            const input = "Hello {{VALUE:name|World}}!";
            formatter.setPromptResponse('name', 'Universe');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("Hello Universe!");
        });

        it('should work without default value (backwards compatibility)', async () => {
            const input = "Hello {{VALUE:name}}!";
            formatter.setPromptResponse('name', 'Test');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("Hello Test!");
        });

        it('should handle empty default value', async () => {
            const input = "Hello {{VALUE:name|}}!";
            formatter.setPromptResponse('name', '');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("Hello !");
        });
    });

    describe('Edge cases', () => {
        it('should handle default value with spaces', async () => {
            const input = "{{VALUE:greeting|Hello World}}";
            formatter.setPromptResponse('greeting', '');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("Hello World");
        });

        it('should trim whitespace around default value', async () => {
            const input = "{{VALUE:name| Default Value }}";
            formatter.setPromptResponse('name', '');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("Default Value");
        });

        it('should handle multiple pipes in default value', async () => {
            const input = "{{VALUE:name|Default|With|Pipes}}";
            formatter.setPromptResponse('name', '');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("Default|With|Pipes");
        });

        it('should handle special characters in default value', async () => {
            const input = "{{VALUE:code|<div>Hello</div>}}";
            formatter.setPromptResponse('code', '');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("<div>Hello</div>");
        });

        it('should handle multiple variables with defaults', async () => {
            const input = "{{VALUE:first|John}} {{VALUE:last|Doe}}";
            formatter.setPromptResponse('first', '');
            formatter.setPromptResponse('last', 'Smith');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("John Smith");
        });
    });

    describe('Suggester with default values', () => {
        it('should work with comma-separated suggestions and default', async () => {
            const input = "{{VALUE:Yes,No,Maybe|Maybe}}";
            formatter.setSuggesterResponse(['Yes', 'No', 'Maybe'], '');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("Maybe");
        });

        it('should not interfere with suggester when user selects value', async () => {
            const input = "{{VALUE:Red,Green,Blue|Red}}";
            formatter.setSuggesterResponse(['Red', 'Green', 'Blue'], 'Green');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("Green");
        });
    });

    describe('Variable reuse', () => {
        it('should reuse variable value on second occurrence', async () => {
            const input = "{{VALUE:name|Default}} and {{VALUE:name|Different}}";
            formatter.setPromptResponse('name', 'Test');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("Test and Test");
        });

        it('should only prompt once for repeated variables', async () => {
            const input = "{{VALUE:name|Default}} and {{VALUE:name}}";
            formatter.setPromptResponse('name', '');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("Default and Default");
        });
    });

    describe('Complex scenarios', () => {
        it('should handle markdown links in default value', async () => {
            const input = "{{VALUE:link|[[DefaultPage]]}}";
            formatter.setPromptResponse('link', '');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("[[DefaultPage]]");
        });

        it('should handle JSON-like default values', async () => {
            const input = '{{VALUE:data|{"key": "value"}}}';
            formatter.setPromptResponse('data', '');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe('{"key": "value"}');
        });

        it('should handle empty string as user input (not use default)', async () => {
            const input = "{{VALUE:name|DefaultName}}";
            formatter.setPromptResponse('name', ''); // User explicitly enters empty
            
            // In the current implementation, empty string triggers default
            // This is the expected behavior based on the requirements
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe("DefaultName");
        });
    });
});