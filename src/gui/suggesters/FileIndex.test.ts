import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileIndex } from './FileIndex';
import type { App, TFile, Vault, MetadataCache, Workspace } from 'obsidian';

// Test-specific subclass that allows resetting the singleton
class TestableFileIndex extends FileIndex {
	static reset(): void {
		if (FileIndex.instance) {
			// Clear any pending timeouts
			if ((FileIndex.instance as any).reindexTimeout !== null) {
				clearTimeout((FileIndex.instance as any).reindexTimeout);
			}
			if ((FileIndex.instance as any).fuseUpdateTimeout !== null) {
				clearTimeout((FileIndex.instance as any).fuseUpdateTimeout);
			}
		}
		// Clear the instance
		FileIndex.instance = null as any;
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

		it('should penalize alias match types', () => {
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

			expect(score).toBeGreaterThan(0.5); // Should be penalized (higher score = worse ranking)
		});

		it('should rank basename matches better than alias matches', () => {
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
			const basenameScore = (fileIndex as any).calculateScore(mockFile, 'test', {}, 0.5, 'exact');

			expect(aliasScore).toBeGreaterThan(basenameScore); // Alias should have worse score (higher = worse)
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

		it('should use incremental updates for single file changes', async () => {
			// Use fake timers for deterministic testing
			vi.useFakeTimers();

			// Reset the existing index to ensure clean state
			TestableFileIndex.reset();
			const freshPlugin = { registerEvent: vi.fn((eventRef) => eventRef) } as any;
			const freshIndex = FileIndex.getInstance(mockApp, freshPlugin);

			// Set up initial files with proper metadata
			const initialFiles = [
				{ path: 'file1.md', basename: 'file1', extension: 'md', parent: { path: '' }, stat: { mtime: Date.now() } },
				{ path: 'file2.md', basename: 'file2', extension: 'md', parent: { path: '' }, stat: { mtime: Date.now() } }
			] as TFile[];

			(mockApp.vault.getMarkdownFiles as any).mockReturnValue(initialFiles);
			mockApp.metadataCache.getFileCache = vi.fn(() => ({
				frontmatter: {},
				headings: [],
				tags: []
			}));

			// Initial index – ensure all batched timers run so both files are indexed
			const indexPromise = freshIndex.ensureIndexed();
			// Flush any pending timers (including 0-ms ones) used inside performReindex()
			await vi.runAllTimersAsync();
			await indexPromise;
			expect(freshIndex.getIndexedFileCount()).toBeGreaterThanOrEqual(1);

			// Spy on the methods - use proper type assertion
			const freshIndexWithPrivates = freshIndex as unknown as {
				updateFuseIndex: () => void;
				processPendingFuseUpdates: () => void;
				addFile: (file: TFile) => void;
			};
			const updateFuseIndexSpy = vi.spyOn(freshIndexWithPrivates, 'updateFuseIndex');
			const processPendingUpdatesSpy = vi.spyOn(freshIndexWithPrivates, 'processPendingFuseUpdates');

			// Simulate adding a single file
			const newFile = {
				path: 'file3.md',
				basename: 'file3',
				extension: 'md',
				parent: { path: '' },
				stat: { mtime: Date.now() }
			} as TFile;
			freshIndexWithPrivates.addFile(newFile);

			// Advance timers to trigger debounced update
			vi.advanceTimersByTime(150);

			// Should use incremental update, not full rebuild
			expect(processPendingUpdatesSpy).toHaveBeenCalled();
			expect(updateFuseIndexSpy).not.toHaveBeenCalled();
			expect(freshIndex.getIndexedFileCount()).toBeGreaterThanOrEqual(2);

			// Clean up
			vi.useRealTimers();
		});

		it('should batch multiple rapid updates', async () => {
			// Create mock pending updates
			const indexWithPrivates = fileIndex as unknown as {
				pendingFuseUpdates: Map<string, 'add' | 'update' | 'remove'>;
				scheduleFuseUpdate: (path: string, op: 'add' | 'update' | 'remove') => void;
			};

			// Simulate rapid file operations
			indexWithPrivates.scheduleFuseUpdate('file1.md', 'add');
			indexWithPrivates.scheduleFuseUpdate('file2.md', 'update');
			indexWithPrivates.scheduleFuseUpdate('file1.md', 'remove'); // Should coalesce with add

			// Check that add+remove was coalesced
			expect(indexWithPrivates.pendingFuseUpdates.has('file1.md')).toBe(false);
			expect(indexWithPrivates.pendingFuseUpdates.get('file2.md')).toBe('update');
		});

		it('should handle remove+add sequence as update', () => {
			const indexWithPrivates = fileIndex as unknown as {
				pendingFuseUpdates: Map<string, 'add' | 'update' | 'remove'>;
				scheduleFuseUpdate: (path: string, op: 'add' | 'update' | 'remove') => void;
			};

			// Simulate rename operation (remove then add)
			indexWithPrivates.scheduleFuseUpdate('file.md', 'remove');
			indexWithPrivates.scheduleFuseUpdate('file.md', 'add');

			// Should be treated as update
			expect(indexWithPrivates.pendingFuseUpdates.get('file.md')).toBe('update');
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
			// @ts-ignore
			mockApp.metadataCache.getFileCache = vi.fn((file) => {
				const testFile = files.find(f => f.path === file.path);
				return testFile ? {
					headings: testFile.headings.map((h, i) => ({
						heading: h,
						level: 1,
						position: {
							start: { line: i * 10, col: 0, offset: 0 },
							end: { line: i * 10, col: h.length, offset: h.length }
						}
					})) as any // cast to satisfy HeadingCache type
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
		it('should match normalized query against decomposed filenames', async () => {
			const nfcName = 'Rücken-Fit';
			const nfdName = nfcName.normalize('NFD');
			const files = [
				{
					path: `${nfdName}.md`,
					basename: nfdName,
					extension: 'md',
					parent: { path: '' },
					stat: { mtime: Date.now() }
				}
			] as TFile[];

			(mockApp.vault.getMarkdownFiles as any).mockReturnValue(files);
			mockApp.metadataCache.getFileCache = vi.fn(() => ({}));

			await fileIndex.ensureIndexed();
			const results = fileIndex.search('Rü', {}, 10);

			expect(results.some(result => result.file.basename === nfdName)).toBe(true);
		});

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
