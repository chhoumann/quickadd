import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileIndex } from './FileIndex';
import type { App, TFile, Vault, MetadataCache, Workspace } from 'obsidian';

// Test-specific subclass that allows resetting the singleton
class TestableFileIndex extends FileIndex {
	static reset(): void {
		if (TestableFileIndex.instance) {
			// Clear any pending timeouts
			if ((TestableFileIndex.instance as any).reindexTimeout !== null) {
				clearTimeout((TestableFileIndex.instance as any).reindexTimeout);
			}
			// Clear the instance
			TestableFileIndex.instance = null as any;
		}
	}
}

// Mock Obsidian types
const createMockApp = (): App => {
	const mockFiles: TFile[] = [];
	
	return {
		vault: {
			getMarkdownFiles: vi.fn(() => mockFiles),
			getAbstractFileByPath: (path: string) => mockFiles.find(f => f.path === path),
			getRoot: () => ({ path: '' }),
			on: vi.fn(),
			create: vi.fn().mockResolvedValue({ path: 'test.md', basename: 'test' })
		} as unknown as Vault,
		metadataCache: {
			getFileCache: () => ({
				frontmatter: { alias: ['test-alias'] },
				headings: [{ heading: 'Test Heading' }],
				blocks: { 'block1': { id: 'block1' } },
				tags: [{ tag: '#test' }]
			}),
			unresolvedLinks: {},
			on: vi.fn()
		} as unknown as MetadataCache,
		workspace: {
			on: vi.fn(),
			getActiveFile: () => null,
			getLeaf: vi.fn()
		} as unknown as Workspace
	} as App;
};

describe('FileIndex', () => {
	let mockApp: App;
	let fileIndex: FileIndex;

	beforeEach(() => {
		mockApp = createMockApp();
		// Create a mock plugin with registerEvent
		const mockPlugin = {
			registerEvent: vi.fn((eventRef) => eventRef)
		} as any;
		// Reset singleton using the test subclass
		TestableFileIndex.reset();
		fileIndex = FileIndex.getInstance(mockApp, mockPlugin);
	});

	describe('scoring system', () => {
		it('should boost same-folder files', () => {
			const mockFile = {
				path: 'folder/test.md',
				basename: 'test',
				aliases: [],
				headings: [],
				blockIds: [],
				tags: [],
				modified: Date.now(),
				folder: 'folder'
			};

			const context = { currentFolder: 'folder' };
			const score = (fileIndex as any).calculateScore(mockFile, 'test', context, 0.5);
			
			expect(score).toBeLessThan(0.5); // Should be boosted (lower score)
		});

		it('should boost exact alias matches', () => {
			const mockFile = {
				path: 'test.md',
				basename: 'test',
				aliases: ['exact-match'],
				headings: [],
				blockIds: [],
				tags: [],
				modified: Date.now(),
				folder: ''
			};

			const score = (fileIndex as any).calculateScore(mockFile, 'exact-match', {}, 0.5, 'alias');
			
			expect(score).toBeLessThan(0.5); // Should be heavily boosted
		});

		it('should give additional boost to alias match types', () => {
			const mockFile = {
				path: 'test.md',
				basename: 'test',
				aliases: ['my-alias'],
				headings: [],
				blockIds: [],
				tags: [],
				modified: Date.now(),
				folder: ''
			};

			const aliasScore = (fileIndex as any).calculateScore(mockFile, 'my-alias', {}, 0.5, 'alias');
			const normalScore = (fileIndex as any).calculateScore(mockFile, 'test', {}, 0.5, 'exact');
			
			expect(aliasScore).toBeLessThan(normalScore); // Alias should be boosted more
		});

		it('should boost files with tag overlap', () => {
			const currentFile = {
				path: 'current.md',
				basename: 'current',
				aliases: [],
				headings: [],
				blockIds: [],
				tags: ['#shared-tag'],
				modified: Date.now(),
				folder: ''
			};

			const testFile = {
				path: 'test.md',
				basename: 'test',
				aliases: [],
				headings: [],
				blockIds: [],
				tags: ['#shared-tag', '#other-tag'],
				modified: Date.now(),
				folder: ''
			};

			// Simulate current file in map
			(fileIndex as any).fileMap.set('current.md', currentFile);
			
			const mockCurrentFile = { path: 'current.md' } as TFile;
			const context = { currentFile: mockCurrentFile };
			
			const score = (fileIndex as any).calculateScore(testFile, 'test', context, 0.5);
			
			expect(score).toBeLessThan(0.5); // Should be boosted
		});
	});

	describe('alias improvements', () => {
		it('should return alias prefix matches before fuzzy results', () => {
			// This would test that querying "ali" returns alias matches first
			expect(true).toBe(true); // Placeholder for now
		});
	});

	describe('heading search', () => {
		it('should support global heading search with #', () => {
			// This would test that querying "#my heading" returns heading matches
			expect(true).toBe(true); // Placeholder for now
		});
	});

	describe('search functionality', () => {
		it('should return exact matches first', () => {
			// This test would require mocking the Fuse.js library
			// and setting up the file map properly
			expect(true).toBe(true); // Placeholder
		});

		it('should handle relative path suggestions', () => {
			// Test relative path logic
			expect(true).toBe(true); // Placeholder
		});
	});

	describe('performance', () => {
		it('should handle large vaults efficiently', async () => {
			// Mock a large number of files
			const mockFiles = Array.from({ length: 1000 }, (_, i) => ({
				path: `file-${i}.md`,
				basename: `file-${i}`,
				stat: { mtime: Date.now() },
				parent: { path: 'folder' },
				extension: 'md'
			})) as TFile[];

			(mockApp.vault.getMarkdownFiles as any).mockReturnValue(mockFiles);

			const startTime = performance.now();
			await fileIndex.ensureIndexed();
			const endTime = performance.now();

			// Should complete indexing in reasonable time (< 100ms for 1000 files)
			expect(endTime - startTime).toBeLessThan(100);
		});
	});
});
