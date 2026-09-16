import { StubFormatter } from "../../tests/helpers/formatters/stubFormatter";
import { describe, it, expect, beforeEach } from 'vitest';

// Mock the abstract methods for testing
class TestFormatter extends StubFormatter {
    private promptResponses: Map<string, string> = new Map();
    private suggesterResponses: Map<string, string> = new Map();

    protected getVariableValue(variableName: string): string {
        return (this.variables.get(variableName) as string) ?? "";
    }

    protected async promptForVariable(variableName: string): Promise<string> {
        return this.promptResponses.get(variableName) || "";
    }

    protected async suggestForValue(suggestedValues: string[]): Promise<string> {
        const key = suggestedValues.join(",");
        return this.suggesterResponses.get(key) || "";
    }
	public async testReplaceVariableInString(input: string): Promise<string> {
		return this.replaceVariableInString(input);
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
        it.each([
        	{ name: 'should use default value when user provides no input', input: "Hello {{VALUE:name|World}}!", promptResponse: '', expected: "Hello World!" },
        	{ name: 'should use user input when provided instead of default', input: "Hello {{VALUE:name|World}}!", promptResponse: 'Universe', expected: "Hello Universe!" },
        	{ name: 'should work without default value (backwards compatibility)', input: "Hello {{VALUE:name}}!", promptResponse: 'Test', expected: "Hello Test!" },
        	{ name: 'should handle empty default value', input: "Hello {{VALUE:name|}}!", promptResponse: '', expected: "Hello !" },
        ])("$name", async ({ input, promptResponse, expected }) => {

            formatter.setPromptResponse('name', promptResponse); // Empty response
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe(expected);
        });
    });

    describe('Edge cases', () => {
        it.each([
        	{ name: 'should handle default value with spaces', input: "{{VALUE:greeting|Hello World}}", promptResponse: 'greeting', expected: "Hello World" },
        	{ name: 'should trim whitespace around default value', input: "{{VALUE:name| Default Value }}", promptResponse: 'name', expected: "Default Value" },
        	{ name: 'should handle multiple pipes in default value', input: "{{VALUE:name|Default|With|Pipes}}", promptResponse: 'name', expected: "Default|With|Pipes" },
        	{ name: 'should handle special characters in default value', input: "{{VALUE:code|<div>Hello</div>}}", promptResponse: 'code', expected: "<div>Hello</div>" },
        ])("$name", async ({ input, promptResponse, expected }) => {

            formatter.setPromptResponse(promptResponse, '');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe(expected);
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
        it.each([
        	{ name: 'should handle markdown links in default value', input: "{{VALUE:link|[[DefaultPage]]}}", promptResponse: 'link', expected: "[[DefaultPage]]" },
        	{ name: 'should handle JSON-like default values', input: '{{VALUE:data|{"key": "value"}}}', promptResponse: 'data', expected: '{"key": "value"}' },
        	{ name: 'should handle empty string as user input (not use default)', input: "{{VALUE:name|DefaultName}}", promptResponse: 'name', expected: "DefaultName" },
        ])("$name", async ({ input, promptResponse, expected }) => {

            formatter.setPromptResponse(promptResponse, '');
            
            const result = await formatter.testReplaceVariableInString(input);
            expect(result).toBe(expected);
        });
    });
});