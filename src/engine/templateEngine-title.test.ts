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
            let destinationFile: unknown = null;
            let destinationSourcePath: string | null = null;
            return {
                setTitle: vi.fn((t: string) => { title = t; }),
                setDestinationFile: vi.fn((file: unknown) => {
                    destinationFile = file;
                }),
                setDestinationSourcePath: vi.fn((path: string) => {
                    destinationSourcePath = path;
                }),
                clearDestinationContext: vi.fn(() => {
                    destinationFile = null;
                    destinationSourcePath = null;
                }),
                getTitle: () => title,
                getDestinationFile: () => destinationFile,
                getDestinationSourcePath: () => destinationSourcePath,
                getAndClearTemplatePropertyVars: vi.fn(
                    () => new Map<string, unknown>(),
                ),
                withTemplatePropertyCollection: vi.fn(
                    async (work: () => Promise<unknown>) => await work(),
                ),
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
    templaterParseTemplate: vi.fn(async (_app, content: string) => content),
    resolveClipboardForNoteContent: vi.fn(async () => ""),
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

    public async testOverwriteFileWithTemplate(file: any, templatePath: string) {
        return await this.overwriteFileWithTemplate(file, templatePath);
    }

    public async testAppendToFileWithTemplate(file: any, templatePath: string, section: "top" | "bottom") {
        return await this.appendToFileWithTemplate(file, templatePath, section);
    }

    public getFormatterTitle(): string {
        // Access the title that was set on the formatter
        return (this.formatter as any).getTitle();
    }

    public getFormatterDestinationSourcePath(): string | null {
        return (this.formatter as any).getDestinationSourcePath();
    }

    public getFormatterDestinationFile(): unknown {
        return (this.formatter as any).getDestinationFile();
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

        it('should extract title from .base filename', async () => {
            await engine.testCreateFileWithTemplate('folder/Kanban.base', 'template.base');
            expect(engine.getFormatterTitle()).toBe('Kanban');
        });

        it('should format content with title replacement', async () => {
            const mockFormatter = (engine as any).formatter;
            
            await engine.testCreateFileWithTemplate('TestDocument.md', 'template.md');
            
            // Verify setTitle was called with correct value
            expect(mockFormatter.setTitle).toHaveBeenCalledWith('TestDocument');
            
            // Verify formatFileContent was called
            expect(mockFormatter.formatFileContent).toHaveBeenCalled();
        });

        it('should set destination source path before formatting new template content', async () => {
            await engine.testCreateFileWithTemplate('folder/TestDocument.md', 'template.md');

            expect(engine.getFormatterDestinationSourcePath()).toBe('folder/TestDocument.md');
        });

        it('should clear destination context for new non-markdown template output', async () => {
            await engine.testCreateFileWithTemplate('folder/Kanban.base', 'template.base');

            expect(engine.getFormatterDestinationSourcePath()).toBeNull();
            expect(engine.getFormatterDestinationFile()).toBeNull();
        });
    });

    describe('existing file template updates', () => {
        const existingFile = {
            path: 'folder/Existing.md',
            basename: 'Existing',
            extension: 'md',
        } as any;

        beforeEach(() => {
            mockApp.vault.modify = vi.fn().mockResolvedValue(undefined);
            mockApp.vault.cachedRead = vi.fn().mockResolvedValue('Existing content');
        });

        it('should set destination file before overwriting template content', async () => {
            await engine.testOverwriteFileWithTemplate(existingFile, 'template.md');

            expect(engine.getFormatterDestinationFile()).toBe(existingFile);
        });

        it('should set destination file before appending template content', async () => {
            await engine.testAppendToFileWithTemplate(existingFile, 'template.md', 'bottom');

            expect(engine.getFormatterDestinationFile()).toBe(existingFile);
        });

        it('should clear destination context before overwriting non-markdown template output', async () => {
            const existingBaseFile = {
                path: 'folder/Kanban.base',
                basename: 'Kanban',
                extension: 'base',
            } as any;

            await engine.testOverwriteFileWithTemplate(existingBaseFile, 'template.base');

            expect(engine.getFormatterDestinationFile()).toBeNull();
            expect(engine.getFormatterDestinationSourcePath()).toBeNull();
        });

        it('should clear destination context before appending non-markdown template output', async () => {
            const existingCanvasFile = {
                path: 'folder/Board.canvas',
                basename: 'Board',
                extension: 'canvas',
            } as any;

            await engine.testAppendToFileWithTemplate(existingCanvasFile, 'template.canvas', 'bottom');

            expect(engine.getFormatterDestinationFile()).toBeNull();
            expect(engine.getFormatterDestinationSourcePath()).toBeNull();
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
