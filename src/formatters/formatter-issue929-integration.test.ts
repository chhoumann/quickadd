import { describe, it, expect, beforeEach } from 'vitest';
import { Formatter } from './formatter';

// Integration test that exactly reproduces issue #929 scenario
class CaptureFormatterTest extends Formatter {
    constructor() {
        super();
    }

    private scriptVariables: Map<string, unknown> = new Map();
    
    protected async format(input: string): Promise<string> {
        // Simulate complete formatting pipeline
        let output = input;
        output = await this.replaceVariableInString(output);
        output = this.replaceTitleInString(output);
        return output;
    }

    // Simulate script setting variables (like User Script in macro)
    public simulateScriptSetVariable(name: string, value: unknown): void {
        this.scriptVariables.set(name, value);
        this.variables.set(name, value);
    }

    protected promptForValue(): string {
        return "";
    }

    protected getCurrentFileLink(): string | null {
        return null;
    }

    protected getCurrentFileName(): string | null {
        return null;
    }

    protected getVariableValue(variableName: string): string {
        return (this.variables.get(variableName) as string) ?? "";
    }

    protected suggestForValue(
        _suggestedValues: string[],
        _allowCustomInput?: boolean,
        _context?: { placeholder?: string; variableKey?: string },
    ): string {
        return "";
    }

    protected suggestForField(_variableName: string): Promise<string> {
        return Promise.resolve("");
    }

    protected promptForMathValue(): Promise<string> {
        return Promise.resolve("");
    }

    protected getMacroValue(
        _macroName: string,
        _context?: { label?: string },
    ): string {
        return "";
    }

    protected promptForVariable(
        _variableName: string,
        _context?: {
            type?: string;
            dateFormat?: string;
            defaultValue?: string;
            label?: string;
            description?: string;
            placeholder?: string;
            variableKey?: string;
        },
    ): Promise<string> {
        return Promise.resolve("");
    }

    protected getTemplateContent(_templatePath: string): Promise<string> {
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

    // Test helpers
    public async formatCapture(input: string): Promise<string> {
        return await this.format(input);
    }
    
    public hasScriptSetTitle(): boolean {
        return this.scriptVariables.has('title');
    }
}

describe('Issue #929 Integration Test: Full Macro Flow', () => {
    let formatter: CaptureFormatterTest;

    beforeEach(() => {
        formatter = new CaptureFormatterTest();
    });

    it('should reproduce the complete macro scenario from issue #929', async () => {
        // === STEP 1: User Script runs ===
        // This simulates: module.exports = async ({ variables }) => { variables.title = "Script Provided Title"; };
        formatter.simulateScriptSetVariable('title', 'Script Provided Title');
        expect(formatter.hasScriptSetTitle()).toBe(true);

        // === STEP 2: Capture engine processes target file ===
        // The capture engine opens "My Note.md" and calls setTitle(file.basename)
        // This was the bug: it overwrote the script's title value
        formatter.setTitle('My Note');

        // === STEP 3: Capture formatting runs ===
        // The capture choice uses format "Captured: {{VALUE:title}}"
        const result = await formatter.formatCapture('Captured: {{VALUE:title}}');

        // === EXPECTED RESULT ===
        // Before fix: "Captured: My Note" (file basename overwrote script value)
        // After fix: "Captured: Script Provided Title" (script value preserved)
        expect(result).toBe('Captured: Script Provided Title');
    });

    it('should preserve script values while allowing fallback behavior', async () => {
        // Test normal case where no script sets title
        formatter.setTitle('Regular File');
        const result1 = await formatter.formatCapture('Title: {{VALUE:title}}');
        expect(result1).toBe('Title: Regular File');

        // Reset formatter
        formatter = new CaptureFormatterTest();
        
        // Test script override case
        formatter.simulateScriptSetVariable('title', 'Custom Script Title');
        formatter.setTitle('Regular File');
        const result2 = await formatter.formatCapture('Title: {{VALUE:title}}');
        expect(result2).toBe('Title: Custom Script Title');
    });

    it('should work consistently with both {{title}} and {{VALUE:title}}', async () => {
        // Both should behave identically after the fix
        formatter.simulateScriptSetVariable('title', 'Consistent Title');
        formatter.setTitle('File Basename');
        
        const titleResult = await formatter.formatCapture('{{title}}');
        const valueResult = await formatter.formatCapture('{{VALUE:title}}');
        
        expect(titleResult).toBe('Consistent Title');
        expect(valueResult).toBe('Consistent Title');
        expect(titleResult).toBe(valueResult); // Should be identical
    });

    it('should handle edge case: empty script title', async () => {
        // Script explicitly sets empty title
        formatter.simulateScriptSetVariable('title', '');
        formatter.setTitle('File Basename');
        
        const result = await formatter.formatCapture('{{VALUE:title}}');
        expect(result).toBe(''); // Should respect script's empty string, not fall back
    });

    it('should handle edge case: null/undefined from script', async () => {
        // Script sets null (which should be treated as "no value set")
        formatter.simulateScriptSetVariable('title', null);
        formatter.setTitle('File Basename');
        
        const result = await formatter.formatCapture('{{VALUE:title}}');
        expect(result).toBe('File Basename'); // Should fall back to file basename
        
        // Reset and test undefined
        formatter = new CaptureFormatterTest();
        formatter.simulateScriptSetVariable('title', undefined);
        formatter.setTitle('File Basename');
        
        const result2 = await formatter.formatCapture('{{VALUE:title}}');
        expect(result2).toBe('File Basename'); // Should fall back to file basename
    });
});
