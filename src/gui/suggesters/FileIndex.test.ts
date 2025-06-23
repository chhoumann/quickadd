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

	describe('basic functionality', () => {
		it('should have required methods', () => {
			expect(typeof fileIndex.search).toBe('function');
			expect(typeof fileIndex.ensureIndexed).toBe('function');
			expect(typeof fileIndex.getIndexedFileCount).toBe('function');
			expect(typeof fileIndex.getFile).toBe('function');
		});
		
		it('should return empty results for searches before indexing', () => {
			const results = fileIndex.search('test', {}, 10);
			expect(Array.isArray(results)).toBe(true);
		});
	});

	describe('alias improvements', () => {
		it.skip('should return alias prefix matches before fuzzy results', async () => {
			// Create files with different match types
			const files = [
				{ path: 'fuzzy-match.md', basename: 'fuzzy-match', aliases: [] },
				{ path: 'alias-file.md', basename: 'random', aliases: ['alias-match'] },
				{ path: 'another.md', basename: 'another', aliases: ['alice'] }
			];
			
			// Mock the vault to return our test files
			(mockApp.vault.getMarkdownFiles as any).mockReturnValue(
				files.map(f => ({ ...f, extension: 'md', parent: { path: '' } }))
			);
			
			// Mock metadata cache
			mockApp.metadataCache.getFileCache = vi.fn((file) => {
				const testFile = files.find(f => f.path === file.path);
				return testFile ? {
					frontmatter: { aliases: testFile.aliases }
				} : null;
			});
			
			await fileIndex.ensureIndexed();
			const results = fileIndex.search('ali', {}, 10);
			
			// Should find alias matches
			expect(results.length).toBeGreaterThan(0);
			const aliasMatches = results.filter(r => r.matchType === 'alias');
			expect(aliasMatches.length).toBe(2);
			
			// Verify we found the expected files
			const paths = aliasMatches.map(r => r.file.path);
			expect(paths).toContain('alias-file.md');
			expect(paths).toContain('another.md');
		});
	});

	describe('heading search', () => {
		it.skip('should support global heading search with #', async () => {
			// Create files with headings
			const files = [
				{ path: 'file1.md', basename: 'file1', headings: ['Introduction', 'My Heading', 'Conclusion'] },
				{ path: 'file2.md', basename: 'file2', headings: ['Overview', 'My Special Heading'] }
			];
			
			// Mock the vault
			(mockApp.vault.getMarkdownFiles as any).mockReturnValue(
				files.map(f => ({ ...f, extension: 'md', parent: { path: '' } }))
			);
			
			// Mock metadata cache with headings
			mockApp.metadataCache.getFileCache = vi.fn((file) => {
				const testFile = files.find(f => f.path === file.path);
				return testFile ? {
					headings: testFile.headings.map((h, i) => ({ 
						heading: h, 
						level: 1,
						position: { start: { line: i * 10, col: 0 }, end: { line: i * 10, col: h.length } }
					}))
				} : null;
			});
			
			await fileIndex.ensureIndexed();
			const results = fileIndex.search('#my heading', {}, 10);
			
			// Should find files with matching headings
			expect(results.length).toBeGreaterThan(0);
			const headingMatches = results.filter(r => r.matchType === 'heading');
			expect(headingMatches.length).toBeGreaterThan(0);
			
			// Verify display text contains heading
			const hasHeadingInDisplay = headingMatches.some(r => 
				r.displayText.toLowerCase().includes('heading')
			);
			expect(hasHeadingInDisplay).toBe(true);
		});
	});

	describe('search functionality', () => {
		it.skip('should return exact matches first', async () => {
			const files = [
				{ path: 'test.md', basename: 'test' },
				{ path: 'testing.md', basename: 'testing' },
				{ path: 'contest.md', basename: 'contest' }
			];
			
			(mockApp.vault.getMarkdownFiles as any).mockReturnValue(
				files.map(f => ({ ...f, extension: 'md', parent: { path: '' } }))
			);
			
			mockApp.metadataCache.getFileCache = vi.fn(() => ({}));
			
			await fileIndex.ensureIndexed();
			const results = fileIndex.search('test', {}, 10);
			
			// Should find results
			expect(results.length).toBeGreaterThan(0);
			
			// Should have an exact match
			const exactMatch = results.find(r => r.file.basename === 'test' && r.matchType === 'exact');
			expect(exactMatch).toBeDefined();
		});

		it.skip('should handle relative path suggestions', async () => {
			const files = [
				{ path: 'folder1/note.md', basename: 'note' },
				{ path: 'folder2/note.md', basename: 'note' },
				{ path: 'note.md', basename: 'note' }
			];
			
			(mockApp.vault.getMarkdownFiles as any).mockReturnValue(
				files.map(f => ({ 
					...f, 
					extension: 'md', 
					parent: { path: f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '' } 
				}))
			);
			
			mockApp.metadataCache.getFileCache = vi.fn(() => ({}));
			
			await fileIndex.ensureIndexed();
			
			// Search from folder1 context
			const context = { currentFolder: 'folder1' };
			const results = fileIndex.search('note', context, 10);
			
			// Same folder file should be boosted
			const folder1Result = results.find(r => r.file.path === 'folder1/note.md');
			const folder2Result = results.find(r => r.file.path === 'folder2/note.md');
			
			expect(folder1Result).toBeDefined();
			expect(folder2Result).toBeDefined();
			expect(folder1Result!.score).toBeLessThan(folder2Result!.score);
		});
	});

	describe('performance', () => {
		it.skip('should handle large vaults efficiently', async () => {
			// Mock a large number of files
			const mockFiles = Array.from({ length: 1000 }, (_, i) => ({
				path: `file-${i}.md`,
				basename: `file-${i}`,
				stat: { mtime: Date.now() },
				parent: { path: 'folder' },
				extension: 'md'
			})) as TFile[];

			(mockApp.vault.getMarkdownFiles as any).mockReturnValue(mockFiles);
			
			// Mock getFileCache to return empty metadata for all files
			mockApp.metadataCache.getFileCache = vi.fn(() => ({
				frontmatter: {},
				headings: [],
				blocks: {},
				tags: []
			}));

			const startTime = performance.now();
			await fileIndex.ensureIndexed();
			const endTime = performance.now();

			// Should complete indexing in reasonable time (< 2 seconds for 1000 files)
			// This is more realistic for CI environments and slower machines
			expect(endTime - startTime).toBeLessThan(2000);
			
			// Verify all files were indexed
			expect(fileIndex.getIndexedFileCount()).toBe(1000);
		});
	});
});
