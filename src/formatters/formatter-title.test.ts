import { StubFormatter as FormatterStub } from "../../tests/helpers/formatters/stubFormatter";
import { describe, it, expect, beforeEach } from 'vitest';

// Create a test implementation of the abstract Formatter class
class TestFormatter extends FormatterStub {

    protected async format(input: string): Promise<string> {
        let output = input;
        output = this.replaceTitleInString(output);
        return output;
    }

    protected promptForValue(): string {
        return "test value";
    }

    protected getVariableValue(variableName: string): string {
        return (this.variables.get(variableName) as string) ?? "";
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
        it.each([
	{ name: 'should replace {{title}} with the set title', input: 'Note: {{title}}', expected: 'Note: My Note Title' },
	{ name: 'should replace {{TITLE}} (case insensitive)', input: 'Note: {{TITLE}}', expected: 'Note: My Note Title' },
	{ name: 'should replace multiple {{title}} occurrences', input: '{{title}} - Content - {{title}}', expected: 'My Note Title - Content - My Note Title' },
        ])("$name", ({ input, expected }) => {
            formatter.setTitle('My Note Title');
            const result = formatter.testReplaceTitleInString(input);
            expect(result).toBe(expected);
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

        it('should not overwrite manually set title', () => {
        // Use a public method to simulate script setting the variable
        (formatter as any).variables.set('title', 'Script Provided Title');
        formatter.setTitle('File Basename Title');
        const result = formatter.testReplaceTitleInString('{{title}}');
        expect(result).toBe('Script Provided Title');
		});

		it('should set title when none exists', () => {
			formatter.setTitle('File Basename Title');
			const result = formatter.testReplaceTitleInString('{{title}}');
			expect(result).toBe('File Basename Title');
		});

		it('should preserve script-provided title for {{VALUE:title}} replacement', () => {
			// Simulate script setting title variable
			(formatter as any).variables.set('title', 'Script Provided Title');
			// Simulate engine trying to set title from filename
			formatter.setTitle('My Note');
			// Test that script value is preserved
			const result = (formatter as any).getVariableValue('title');
			expect(result).toBe('Script Provided Title');
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

// Add tests to verify {{title}} error handling in filenames
describe('Formatter - Title Error Handling', () => {
    it('should detect {{title}} pattern in strings', () => {
        const titleRegex = /\{\{title\}\}/i;
        
        expect(titleRegex.test('{{title}}-note.md')).toBe(true);
        expect(titleRegex.test('{{TITLE}}-note.md')).toBe(true);
        expect(titleRegex.test('folder/{{title}}/file.md')).toBe(true);
        expect(titleRegex.test('{{date}}-note.md')).toBe(false);
        expect(titleRegex.test('{{titleSomething}}.md')).toBe(false);
    });
});
