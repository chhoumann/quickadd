import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Formatter } from './formatter';
import { DATE_VARIABLE_REGEX } from '../constants';

// Mock the abstract Formatter class for testing
class TestFormatter extends Formatter {
    public variables = new Map<string, unknown>();
    private mockPromptValue = "";

    constructor() {
        super();
        // Set dateParser via protected property
        //@ts-ignore
        this.dateParser = { 
            parseDate: vi.fn((input: string) => ({
                moment: {
                    toISOString: () => `2025-08-01T00:00:00.000Z`,
                    isValid: () => true,
                    format: (format: string) => `formatted-date-${format}`
                }
            }))
        };
    }

    setMockPromptValue(value: string) {
        this.mockPromptValue = value;
    }

    // Public getter for testing dateParser
    get testDateParser(): any {
        //@ts-ignore
        return this.dateParser;
    }

    protected async format(input: string): Promise<string> {
        return input;
    }

    protected getMacroValue(macroName: string): string {
        return `[macro:${macroName}]`;
    }

    protected async promptForVariable(
        variableName: string,
        context?: { type?: string; dateFormat?: string; defaultValue?: string }
    ): Promise<string> {
        // If a default value is provided and no mock value is set, use the default
        if (context?.defaultValue && !this.mockPromptValue) {
            return context.defaultValue;
        }
        return this.mockPromptValue || `prompted-${variableName}`;
    }

    protected async getTemplateContent(templatePath: string): Promise<string> {
        return `[template:${templatePath}]`;
    }

    protected async suggestForValue(suggestedValues: string[]): Promise<string> {
        return suggestedValues[0] || "";
    }

    protected async suggestForField(variableName: string): Promise<string> {
        return "";
    }

    // Abstract methods that need to be implemented
    protected async promptForValue(variableName: string): Promise<string> {
        return this.mockPromptValue || `prompted-${variableName}`;
    }

    protected getCurrentFileLink(): string {
        return "[[current-file]]";
    }

    protected async promptForMathValue(): Promise<string> {
        return this.mockPromptValue || "42";
    }

    protected getVariableValue(variableName: string): string {
        return this.variables.get(variableName) as string || "";
    }

    protected async getSelectedText(): Promise<string> {
        return "";
    }

    protected async getClipboardContent(): Promise<string> {
        return "";
    }

    protected isTemplatePropertyTypesEnabled(): boolean {
        return false; // Test formatter doesn't need structured YAML variable handling
    }

    // Expose the method for testing
    public async testReplaceDateVariableInString(input: string): Promise<string> {
        return await this.replaceDateVariableInString(input);
    }
}

describe('VDATE Default Value Support', () => {
    let formatter: TestFormatter;

    beforeEach(() => {
        formatter = new TestFormatter();
        // Mock window.moment
        //@ts-ignore
        global.window = {
            //@ts-ignore
            moment: vi.fn((isoString: string) => ({
                isValid: () => true,
                format: (format: string) => `${format}-formatted`
            }))
        };
    });

    describe('Regex Pattern', () => {
        it('should match VDATE with default value', () => {
            const input = "{{VDATE:myDate,YYYY-MM-DD|today}}";
            const match = DATE_VARIABLE_REGEX.exec(input);
            
            expect(match).toBeTruthy();
            expect(match?.[1]).toBe("myDate");
            expect(match?.[2]).toBe("YYYY-MM-DD");
            expect(match?.[3]).toBe("today");
        });

        it('should match VDATE without default value', () => {
            const input = "{{VDATE:myDate,YYYY-MM-DD}}";
            const match = DATE_VARIABLE_REGEX.exec(input);
            
            expect(match).toBeTruthy();
            expect(match?.[1]).toBe("myDate");
            expect(match?.[2]).toBe("YYYY-MM-DD");
            expect(match?.[3]).toBeUndefined();
        });

        it('should match VDATE with complex default values', () => {
            const testCases = [
                { input: "{{VDATE:date,YYYY-MM-DD|next monday}}", defaultValue: "next monday" },
                { input: "{{VDATE:date,YYYY-MM-DD|+7 days}}", defaultValue: "+7 days" },
                { input: "{{VDATE:date,YYYY-MM-DD|2025-12-25}}", defaultValue: "2025-12-25" },
                { input: "{{VDATE:date,YYYY-MM-DD|tomorrow at 3pm}}", defaultValue: "tomorrow at 3pm" }
            ];

            testCases.forEach(({ input, defaultValue }) => {
                const match = DATE_VARIABLE_REGEX.exec(input);
                expect(match?.[3]).toBe(defaultValue);
            });
        });

        it('should handle whitespace around default value', () => {
            const input = "{{VDATE:myDate,YYYY-MM-DD| today }}";
            const match = DATE_VARIABLE_REGEX.exec(input);
            
            expect(match).toBeTruthy();
            expect(match?.[3]).toBe(" today ");
        });
    });

    describe('Default Value Processing', () => {
        it('should use default value when user provides no input', async () => {
            const input = "Test {{VDATE:date,YYYY-MM-DD|today}}";
            formatter.setMockPromptValue(""); // Simulate empty user input
            
            const result = await formatter.testReplaceDateVariableInString(input);
            
            // The formatter should have used "today" as the value
            expect(formatter.testDateParser.parseDate).toHaveBeenCalledWith("today");
            expect(result).toBe("Test YYYY-MM-DD-formatted");
        });

        it('should use user input over default value', async () => {
            const input = "Test {{VDATE:date,YYYY-MM-DD|today}}";
            formatter.setMockPromptValue("tomorrow");
            
            const result = await formatter.testReplaceDateVariableInString(input);
            
            // The formatter should have used "tomorrow" instead of "today"
            expect(formatter.testDateParser.parseDate).toHaveBeenCalledWith("tomorrow");
            expect(result).toBe("Test YYYY-MM-DD-formatted");
        });

        it('should handle multiple VDATE variables with different defaults', async () => {
            const input = "Start: {{VDATE:start,YYYY-MM-DD|today}} End: {{VDATE:end,YYYY-MM-DD|next week}}";
            formatter.setMockPromptValue("");
            
            const result = await formatter.testReplaceDateVariableInString(input);
            
            expect(result).toBe("Start: YYYY-MM-DD-formatted End: YYYY-MM-DD-formatted");
            expect(formatter.testDateParser.parseDate).toHaveBeenCalledWith("today");
            expect(formatter.testDateParser.parseDate).toHaveBeenCalledWith("next week");
        });

        it('should handle VDATE with empty default value', async () => {
            const input = "Test {{VDATE:date,YYYY-MM-DD|}}";
            formatter.setMockPromptValue("");
            
            const result = await formatter.testReplaceDateVariableInString(input);
            
            // Should prompt for value since default is empty
            expect(result).toBe("Test YYYY-MM-DD-formatted");
        });
    });

    describe('Variable Reuse', () => {
        it('should reuse the same variable with different formats and respect the default only on first use', async () => {
            const input = "Date1: {{VDATE:date,YYYY-MM-DD|today}} Date2: {{VDATE:date,MM/DD/YYYY|tomorrow}}";
            formatter.setMockPromptValue("");
            
            const result = await formatter.testReplaceDateVariableInString(input);
            
            // Should use "today" for the first occurrence, then reuse the same variable for the second
            expect(formatter.testDateParser.parseDate).toHaveBeenCalledTimes(1);
            expect(formatter.testDateParser.parseDate).toHaveBeenCalledWith("today");
            expect(result).toBe("Date1: YYYY-MM-DD-formatted Date2: MM/DD/YYYY-formatted");
        });
    });

    describe('Edge Cases', () => {
        it('should handle pipe character in date format', async () => {
            const input = "Test {{VDATE:date,YYYY|MM|DD}}";
            const match = DATE_VARIABLE_REGEX.exec(input);
            
            // The regex splits at the first pipe, treating the rest as default
            expect(match?.[1]).toBe("date");
            expect(match?.[2]).toBe("YYYY");
            expect(match?.[3]).toBe("MM|DD");
        });

        it('should handle incomplete patterns gracefully', async () => {
            const testCases = [
                "{{VDATE:date,YYYY-MM-DD|",  // Missing closing braces
                "{{VDATE:|today}}",          // Missing variable name
                "{{VDATE:,YYYY-MM-DD|today}}" // Missing variable name
            ];

            for (const input of testCases) {
                const result = await formatter.testReplaceDateVariableInString(input);
                // Should return unchanged for incomplete patterns
                expect(result).toBe(input);
            }
        });
        
        it('should handle VDATE with empty default value as valid pattern', async () => {
            const input = "{{VDATE:date,YYYY-MM-DD|}}";
            formatter.setMockPromptValue("2025-08-01");
            
            const result = await formatter.testReplaceDateVariableInString(input);
            
            // Should process normally since it's a valid pattern with empty default
            expect(result).toBe("YYYY-MM-DD-formatted");
        });
    });
});