import { describe, it, expect, beforeEach } from 'vitest';
import { Formatter } from './formatter';

// Test implementation for issue #929 reproduction
class Issue929TestFormatter extends Formatter {
    constructor() {
        super();
    }

    protected async format(input: string): Promise<string> {
        let output = input;
        output = await this.replaceVariableInString(output);
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

    protected isTemplatePropertyTypesEnabled(): boolean {
        return false; // Test formatter doesn't need structured YAML variable handling
    }

    // Expose for testing
    public async testFormat(input: string): Promise<string> {
        return await this.format(input);
    }
}

describe('Issue #929: {{VALUE:title}} resolves to file basename', () => {
    let formatter: Issue929TestFormatter;

    beforeEach(() => {
        formatter = new Issue929TestFormatter();
    });

    it('should use script-provided title instead of file basename for {{VALUE:title}}', async () => {
        // Step 1: Simulate script setting title variable (like from User Script)
        (formatter as any).variables.set('title', 'Script Provided Title');
        
        // Step 2: Simulate engine setting title from file basename (problematic behavior)
        formatter.setTitle('My Note'); // This should NOT overwrite the script value
        
        // Step 3: Test {{VALUE:title}} replacement
        const result = await formatter.testFormat('Captured: {{VALUE:title}}');
        expect(result).toBe('Captured: Script Provided Title');
    });

    it('should fall back to file basename when no script sets title', async () => {
        // Simulate normal case where no script sets title
        formatter.setTitle('My Note');
        
        const result = await formatter.testFormat('Captured: {{VALUE:title}}');
        expect(result).toBe('Captured: My Note');
    });

    it('should handle both {{title}} and {{VALUE:title}} consistently', async () => {
        // Script sets title
        (formatter as any).variables.set('title', 'Script Provided Title');
        formatter.setTitle('My Note');
        
        const titleResult = await formatter.testFormat('Title: {{title}}');
        const valueResult = await formatter.testFormat('Value: {{VALUE:title}}');
        
        expect(titleResult).toBe('Title: Script Provided Title');
        expect(valueResult).toBe('Value: Script Provided Title');
    });

    it('should reproduce the exact bug scenario from issue #929', async () => {
        // Reproduce: QuickAdd script sets title, then capture runs on "My Note" file
        
        // 1. Script runs first: variables.title = "Script Provided Title"
        (formatter as any).variables.set('title', 'Script Provided Title');
        
        // 2. Capture engine sets title from current file basename (the bug)
        formatter.setTitle('My Note');
        
        // 3. Capture format runs with "Captured: {{VALUE:title}}"
        const result = await formatter.testFormat('Captured: {{VALUE:title}}');
        
        // Before fix: would be "Captured: My Note"
        // After fix: should be "Captured: Script Provided Title"
        expect(result).toBe('Captured: Script Provided Title');
    });
});
