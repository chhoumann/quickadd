import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplateEngine } from './TemplateEngine';
import type { App } from 'obsidian';
import type QuickAdd from '../main';
import type { IChoiceExecutor } from '../IChoiceExecutor';

// Mock the CompleteFormatter
vi.mock('../formatters/completeFormatter', () => {
    return {
        CompleteFormatter: vi.fn().mockImplementation(() => {
            let title = '';
            return {
                setTitle: vi.fn((t: string) => { title = t; }),
                getTitle: () => title,
                formatFileContent: vi.fn(async (content: string) => {
                    // Simple mock that replaces {{title}} with the stored title
                    return content.replace(/{{title}}/gi, title);
                }),
                formatFileName: vi.fn(async (name: string) => name),
            };
        })
    };
});

// Mock overwriteTemplaterOnce
vi.mock('../utilityObsidian', () => ({
    getTemplater: vi.fn(() => null),
    overwriteTemplaterOnce: vi.fn().mockResolvedValue(undefined),
}));

// Test implementation of TemplateEngine
class TestTemplateEngine extends TemplateEngine {
    constructor(app: App, plugin: QuickAdd, choiceExecutor: IChoiceExecutor) {
        super(app, plugin, choiceExecutor);
    }

    public async run(): Promise<void> {
        // Not used in these tests
    }

    // Expose protected methods for testing
    public async testCreateFileWithTemplate(filePath: string, templatePath: string) {
        return await this.createFileWithTemplate(filePath, templatePath);
    }

    public getFormatterTitle(): string {
        // Access the title that was set on the formatter
        return (this.formatter as any).getTitle();
    }
}

describe('TemplateEngine - Title Handling', () => {
    let engine: TestTemplateEngine;
    let mockApp: App;
    let mockPlugin: QuickAdd;
    let mockChoiceExecutor: IChoiceExecutor;

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Mock dependencies
        mockApp = {
            vault: {
                adapter: {
                    write: vi.fn(),
                    exists: vi.fn().mockResolvedValue(false),
                },
                create: vi.fn().mockResolvedValue({ path: 'test.md', basename: 'test' }),
            },
            workspace: {
                getActiveFile: vi.fn(),
            },
            fileManager: {
                processFrontMatter: vi.fn(),
            },
            plugins: {
                plugins: {
                    'templater-obsidian': null, // Mock templater as not installed
                },
            },
        } as any;

        mockPlugin = {} as any;
        mockChoiceExecutor = {} as any;

        engine = new TestTemplateEngine(mockApp, mockPlugin, mockChoiceExecutor);
        
        // Mock the template content retrieval
        engine['getTemplateContent'] = vi.fn().mockResolvedValue('# {{title}}\n\nContent here');
    });

    describe('createFileWithTemplate', () => {
        it('should extract title from simple filename', async () => {
            await engine.testCreateFileWithTemplate('MyNote.md', 'template.md');
            expect(engine.getFormatterTitle()).toBe('MyNote');
        });

        it('should extract title from path with folders', async () => {
            await engine.testCreateFileWithTemplate('folder/subfolder/MyNote.md', 'template.md');
            expect(engine.getFormatterTitle()).toBe('MyNote');
        });

        it('should handle filename without extension', async () => {
            await engine.testCreateFileWithTemplate('MyNote', 'template.md');
            expect(engine.getFormatterTitle()).toBe('MyNote');
        });

        it('should handle root level files', async () => {
            await engine.testCreateFileWithTemplate('/MyNote.md', 'template.md');
            expect(engine.getFormatterTitle()).toBe('MyNote');
        });

        it('should handle empty path gracefully', async () => {
            await engine.testCreateFileWithTemplate('', 'template.md');
            expect(engine.getFormatterTitle()).toBe('');
        });

        it('should handle files with multiple dots', async () => {
            await engine.testCreateFileWithTemplate('my.complex.note.md', 'template.md');
            expect(engine.getFormatterTitle()).toBe('my.complex.note');
        });

        it('should extract title from .canvas filename', async () => {
            await engine.testCreateFileWithTemplate('folder/CanvasDoc.canvas', 'template.md');
            expect(engine.getFormatterTitle()).toBe('CanvasDoc');
        });

        it('should format content with title replacement', async () => {
            const mockFormatter = (engine as any).formatter;
            
            await engine.testCreateFileWithTemplate('TestDocument.md', 'template.md');
            
            // Verify setTitle was called with correct value
            expect(mockFormatter.setTitle).toHaveBeenCalledWith('TestDocument');
            
            // Verify formatFileContent was called
            expect(mockFormatter.formatFileContent).toHaveBeenCalled();
        });
    });

    describe('formatFileName - title exclusion', () => {
        it('should NOT replace {{title}} in filename formatting', async () => {
            const mockFormatter = (engine as any).formatter;
            mockFormatter.setTitle('MyTitle');
            
            // formatFileName should not include title replacement
            const result = await mockFormatter.formatFileName('{{title}}-note.md', '');
            
            // The {{title}} should remain unchanged in the filename
            expect(result).toBe('{{title}}-note.md');
        });
    });

});
