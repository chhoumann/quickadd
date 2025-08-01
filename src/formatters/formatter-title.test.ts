import { describe, it, expect, beforeEach } from 'vitest';
import { Formatter } from './formatter';

// Create a test implementation of the abstract Formatter class
class TestFormatter extends Formatter {
    protected async format(input: string): Promise<string> {
        let output = input;
        output = this.replaceTitleInString(output);
        return output;
    }

    protected promptForValue(): string {
        return "test value";
    }

    protected getCurrentFileLink(): string | null {
        return null;
    }

    protected getVariableValue(variableName: string): string {
        return (this.variables.get(variableName) as string) ?? "";
    }

    protected suggestForValue(): string {
        return "";
    }

    protected suggestForField(): Promise<string> {
        return Promise.resolve("");
    }

    protected promptForMathValue(): Promise<string> {
        return Promise.resolve("");
    }

    protected getMacroValue(): string {
        return "";
    }

    protected promptForVariable(): Promise<string> {
        return Promise.resolve("");
    }

    protected getTemplateContent(): Promise<string> {
        return Promise.resolve("");
    }

    protected getSelectedText(): Promise<string> {
        return Promise.resolve("");
    }

    protected getClipboardContent(): Promise<string> {
        return Promise.resolve("");
    }

    // Expose for testing
    public async testFormat(input: string): Promise<string> {
        return await this.format(input);
    }

    public testReplaceTitleInString(input: string): string {
        return this.replaceTitleInString(input);
    }
}

describe('Formatter - Title Handling', () => {
    let formatter: TestFormatter;

    beforeEach(() => {
        formatter = new TestFormatter();
    });

    describe('replaceTitleInString', () => {
        it('should replace {{title}} with the set title', () => {
            formatter.setTitle('My Note Title');
            const result = formatter.testReplaceTitleInString('Note: {{title}}');
            expect(result).toBe('Note: My Note Title');
        });

        it('should replace {{TITLE}} (case insensitive)', () => {
            formatter.setTitle('My Note Title');
            const result = formatter.testReplaceTitleInString('Note: {{TITLE}}');
            expect(result).toBe('Note: My Note Title');
        });

        it('should replace multiple {{title}} occurrences', () => {
            formatter.setTitle('My Note Title');
            const result = formatter.testReplaceTitleInString('{{title}} - Content - {{title}}');
            expect(result).toBe('My Note Title - Content - My Note Title');
        });

        it('should return empty string when title is not set', () => {
            const result = formatter.testReplaceTitleInString('Note: {{title}}');
            expect(result).toBe('Note: ');
        });

        it('should handle mixed case variations', () => {
            formatter.setTitle('My Note Title');
            const result = formatter.testReplaceTitleInString('{{Title}} and {{TITLE}} and {{title}}');
            expect(result).toBe('My Note Title and My Note Title and My Note Title');
        });

        it('should not replace partial matches', () => {
            formatter.setTitle('My Note Title');
            const result = formatter.testReplaceTitleInString('{{titleSomething}} and {title}');
            expect(result).toBe('{{titleSomething}} and {title}');
        });
    });

    describe('setTitle', () => {
        it('should store title in variables map', () => {
            formatter.setTitle('Test Title');
            const result = formatter.testReplaceTitleInString('{{title}}');
            expect(result).toBe('Test Title');
        });

        it('should overwrite previous title', () => {
            formatter.setTitle('First Title');
            formatter.setTitle('Second Title');
            const result = formatter.testReplaceTitleInString('{{title}}');
            expect(result).toBe('Second Title');
        });

        it('should handle empty title', () => {
            formatter.setTitle('');
            const result = formatter.testReplaceTitleInString('Title: {{title}}!');
            expect(result).toBe('Title: !');
        });

        it('should handle special characters in title', () => {
            formatter.setTitle('Title with $pecial & Characters!');
            const result = formatter.testReplaceTitleInString('{{title}}');
            expect(result).toBe('Title with $pecial & Characters!');
        });
    });

    describe('integration with format method', () => {
        it('should work within the format pipeline', async () => {
            formatter.setTitle('Integrated Title');
            const result = await formatter.testFormat('# {{title}}\n\nContent here');
            expect(result).toBe('# Integrated Title\n\nContent here');
        });
    });
});