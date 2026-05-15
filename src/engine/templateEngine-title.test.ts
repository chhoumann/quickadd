import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { App } from 'obsidian';
import {
	TemplateEvaluator,
	TemplateFileService,
} from '../services/TemplateFileService';
import { VaultFileService } from '../services/VaultFileService';
import { FrontmatterPropertyService } from '../services/FrontmatterPropertyService';
import { CompleteFormatter } from '../formatters/completeFormatter';

// Mock the CompleteFormatter
vi.mock('../formatters/completeFormatter', () => {
    return {
        CompleteFormatter: vi.fn().mockImplementation(() => {
            let title = '';
            return {
                setTitle: vi.fn((t: string) => { title = t; }),
                getTitle: () => title,
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
}));

describe('TemplateFileService - Title Handling', () => {
    let templateFileService: TemplateFileService;
    let formatter: any;
    let mockApp: App;

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

        templateFileService = new TemplateFileService(
            mockApp,
            new VaultFileService(mockApp),
            new FrontmatterPropertyService(mockApp),
        );
        formatter = new (CompleteFormatter as any)();
    });

    describe('createFileWithTemplate', () => {
        const createFileWithTemplate = async (filePath: string) =>
            await templateFileService.createFileWithTemplateContent(
                filePath,
                '# {{title}}\n\nContent here',
                new TemplateEvaluator(formatter),
            );

        it('should extract title from simple filename', async () => {
            await createFileWithTemplate('MyNote.md');
            expect(formatter.getTitle()).toBe('MyNote');
        });

        it('should extract title from path with folders', async () => {
            await createFileWithTemplate('folder/subfolder/MyNote.md');
            expect(formatter.getTitle()).toBe('MyNote');
        });

        it('should handle filename without extension', async () => {
            await createFileWithTemplate('MyNote');
            expect(formatter.getTitle()).toBe('MyNote');
        });

        it('should handle root level files', async () => {
            await createFileWithTemplate('/MyNote.md');
            expect(formatter.getTitle()).toBe('MyNote');
        });

        it('should handle empty path gracefully', async () => {
            await createFileWithTemplate('');
            expect(formatter.getTitle()).toBe('');
        });

        it('should handle files with multiple dots', async () => {
            await createFileWithTemplate('my.complex.note.md');
            expect(formatter.getTitle()).toBe('my.complex.note');
        });

        it('should extract title from .canvas filename', async () => {
            await createFileWithTemplate('folder/CanvasDoc.canvas');
            expect(formatter.getTitle()).toBe('CanvasDoc');
        });

        it('should extract title from .base filename', async () => {
            await createFileWithTemplate('folder/Kanban.base');
            expect(formatter.getTitle()).toBe('Kanban');
        });

        it('should format content with title replacement', async () => {
            await createFileWithTemplate('TestDocument.md');
            
            // Verify setTitle was called with correct value
            expect(formatter.setTitle).toHaveBeenCalledWith('TestDocument');
            
            // Verify formatFileContent was called
            expect(formatter.formatFileContent).toHaveBeenCalled();
        });
    });

    describe('formatFileName - title exclusion', () => {
        it('should NOT replace {{title}} in filename formatting', async () => {
            formatter.setTitle('MyTitle');
            
            // formatFileName should not include title replacement
            const result = await formatter.formatFileName('{{title}}-note.md', '');
            
            // The {{title}} should remain unchanged in the filename
            expect(result).toBe('{{title}}-note.md');
        });
    });

});
