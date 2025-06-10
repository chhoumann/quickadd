import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FormatDisplayFormatter } from './formatDisplayFormatter';
import type { App } from 'obsidian';

// Mock the dependencies
vi.mock('../utilityObsidian', () => ({
    getNaturalLanguageDates: vi.fn().mockReturnValue(null)
}));

vi.mock('../engine/SingleTemplateEngine', () => ({
    SingleTemplateEngine: vi.fn()
}));

describe('FormatDisplayFormatter - VDATE Preview', () => {
    let formatter: FormatDisplayFormatter;
    let mockApp: App;
    let mockPlugin: any;

    beforeEach(() => {
        mockApp = {
            workspace: {
                getActiveFile: vi.fn().mockReturnValue(null)
            }
        } as any;
        mockPlugin = {};
        formatter = new FormatDisplayFormatter(mockApp, mockPlugin);
    });

    describe('VDATE preview generation', () => {
        it('should show helpful preview for YYYY-MM-DD format', async () => {
            const input = "{{VDATE:myDate,YYYY-MM-DD}}";
            const result = await formatter.format(input);
            
            // Should show current date in the format with variable name
            expect(result).toMatch(/\d{4}-\d{2}-\d{2} \(myDate\)/);
        });

        it('should show helpful preview for MMM D format', async () => {
            const input = "{{VDATE:eventDate,MMM D}}";
            const result = await formatter.format(input);
            
            // Should show month abbreviation and day with variable name
            expect(result).toMatch(/[A-Z][a-z]{2} \d{1,2} \(eventDate\)/);
        });

        it('should handle multiple VDATE patterns', async () => {
            const input = "{{VDATE:start,YYYY-MM-DD}} to {{VDATE:end,MM/DD}}";
            const result = await formatter.format(input);
            
            expect(result).toMatch(/\d{4}-\d{2}-\d{2} \(start\) to \d{2}\/\d{1,2} \(end\)/);
        });

        it('should fallback gracefully for unknown formats', async () => {
            const input = "{{VDATE:custom,WEIRD_FORMAT}}";
            const result = await formatter.format(input);
            
            // Should contain the variable name and some transformation of the format
            expect(result).toContain("(custom)");
            expect(result).not.toBe(input); // Should be transformed somehow
        });

        it('should handle incomplete VDATE patterns gracefully', async () => {
            const input = "{{VDATE:,}}";
            const result = await formatter.format(input);
            
            // Should return input unchanged for incomplete patterns
            expect(result).toBe(input);
        });

        it('should not crash with malformed VDATE patterns', async () => {
            const input = "{{VDATE:incomplete";
            const result = await formatter.format(input);
            
            // Should return input unchanged
            expect(result).toBe(input);
        });
    });

    describe('Date format preview patterns', () => {
        it('should handle year patterns correctly', async () => {
            const input = "{{VDATE:date,YYYY}} {{VDATE:date2,YY}}";
            const result = await formatter.format(input);
            
            const currentYear = new Date().getFullYear();
            expect(result).toContain(currentYear.toString());
            expect(result).toContain(currentYear.toString().slice(-2));
        });

        it('should handle month patterns correctly', async () => {
            const input = "{{VDATE:date,MM}} {{VDATE:date2,M}} {{VDATE:date3,MMM}}";
            const result = await formatter.format(input);
            
            // Should contain month in different formats
            expect(result).toMatch(/\d{2}/); // MM
            expect(result).toMatch(/[A-Z][a-z]{2}/); // MMM
        });

        it('should handle day patterns correctly', async () => {
            const input = "{{VDATE:date,DD}} {{VDATE:date2,D}}";
            const result = await formatter.format(input);
            
            // Should contain day in different formats
            expect(result).toMatch(/\d{1,2}/);
        });
    });

    describe('Comma support in date formats', () => {
        it('should support commas in date format patterns', async () => {
            const input = "{{VDATE:myDate,MMM D, YYYY}}";
            const result = await formatter.format(input);
            
            // Should show date with comma in format
            expect(result).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4} \(myDate\)/);
        });

        it('should handle multiple commas in date format', async () => {
            const input = "{{VDATE:event,YYYY, MMM D, dddd}}";
            const result = await formatter.format(input);
            
            // Should contain the variable name and some transformation
            expect(result).toContain("(event)");
            expect(result).toContain("2025");
            expect(result).toContain(",");
        });

        it('should work with date formats containing commas and spaces', async () => {
            const input = "{{VDATE:meeting,dddd, MMMM D, YYYY}}";
            const result = await formatter.format(input);
            
            // Should show formatted date with commas
            expect(result).toContain("(meeting)");
            expect(result).not.toBe(input); // Should be transformed
        });

        it('should still work with simple formats without commas', async () => {
            const input = "{{VDATE:simple,YYYY-MM-DD}}";
            const result = await formatter.format(input);
            
            // Should work as before
            expect(result).toMatch(/\d{4}-\d{2}-\d{2} \(simple\)/);
        });
    });
});
