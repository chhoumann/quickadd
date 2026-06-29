import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { itPerf } from '../../../tests/perfUtils';
import { FileIndex } from './FileIndex';
import { normalizeForSearch } from './utils';
import { TFile } from 'obsidian';
import type { App, Vault, MetadataCache, Workspace } from 'obsidian';

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

const createMockIndexedFile = (overrides: {
	path: string;
	basename: string;
	aliases?: string[];
	headings?: string[];
	blockIds?: string[];
	tags?: string[];
	modified?: number;
	folder?: string;
}) => {
	const aliases = overrides.aliases ?? [];
	return {
		path: overrides.path,
		pathNormalized: normalizeForSearch(overrides.path),
		basename: overrides.basename,
		basenameNormalized: normalizeForSearch(overrides.basename),
		aliases,
		aliasesNormalized: aliases.map((alias) => normalizeForSearch(alias)),
		headings: overrides.headings ?? [],
		blockIds: overrides.blockIds ?? [],
		tags: overrides.tags ?? [],
		modified: overrides.modified ?? Date.now(),
		folder: overrides.folder ?? ''
	};
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
			const mockFile = createMockIndexedFile({
				path: 'folder/test.md',
				basename: 'test',
				folder: 'folder'
			});

			const context = { currentFolder: 'folder' };
			const score = (fileIndex as any).calculateScore(mockFile, 'test', context, 0.5);

			expect(score).toBeLessThan(0.5); // Should be boosted (lower score)
		});

		it('should penalize alias match types', () => {
			const mockFile = createMockIndexedFile({
				path: 'test.md',
				basename: 'test',
				aliases: ['exact-match']
			});

			const score = (fileIndex as any).calculateScore(mockFile, 'exact-match', {}, 0.5, 'alias');

			expect(score).toBeGreaterThan(0.5); // Should be penalized (higher score = worse ranking)
		});

		it('should rank basename matches better than alias matches', () => {
			const mockFile = createMockIndexedFile({
				path: 'test.md',
				basename: 'test',
				aliases: ['my-alias']
			});

			const aliasScore = (fileIndex as any).calculateScore(mockFile, 'my-alias', {}, 0.5, 'alias');
			const basenameScore = (fileIndex as any).calculateScore(mockFile, 'test', {}, 0.5, 'exact');

			expect(aliasScore).toBeGreaterThan(basenameScore); // Alias should have worse score (higher = worse)
		});

		it('should boost files with tag overlap', () => {
			const currentFile = createMockIndexedFile({
				path: 'current.md',
				basename: 'current',
				tags: ['#shared-tag']
			});

			const testFile = createMockIndexedFile({
				path: 'test.md',
				basename: 'test',
				tags: ['#shared-tag', '#other-tag']
			});

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

		it('should not rescan unresolved links on every file update, only lazily in search', () => {
			const indexWithPrivates = fileIndex as unknown as {
				updateUnresolvedLinks: () => void;
				updateFile: (file: TFile) => void;
				unresolvedLinksDirty: boolean;
			};

			// Force a clean starting state so update-driven calls are measured directly.
			indexWithPrivates.updateUnresolvedLinks();
			expect(indexWithPrivates.unresolvedLinksDirty).toBe(false);

			const spy = vi.spyOn(indexWithPrivates, 'updateUnresolvedLinks');

			const file = {
				path: 'note.md',
				basename: 'note',
				extension: 'md',
				parent: { path: '' },
				stat: { mtime: Date.now() }
			} as TFile;
			for (let i = 0; i < 5; i++) {
				indexWithPrivates.updateFile(file);
			}

			expect(spy).not.toHaveBeenCalled();
			expect(indexWithPrivates.unresolvedLinksDirty).toBe(true);

			fileIndex.search('no', {}, 10);
			expect(spy).toHaveBeenCalledTimes(1);
			expect(indexWithPrivates.unresolvedLinksDirty).toBe(false);

			fileIndex.search('no', {}, 10);
			expect(spy).toHaveBeenCalledTimes(1);

			spy.mockRestore();
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

	describe('alias extraction', () => {
		it('should split comma-separated alias strings', async () => {
			const files = [
				{
					path: 'test.md',
					basename: 'test',
					extension: 'md',
					parent: { path: '' },
					stat: { mtime: Date.now() }
				}
			] as TFile[];

			(mockApp.vault.getMarkdownFiles as any).mockReturnValue(files);
			mockApp.metadataCache.getFileCache = vi.fn(() => ({
				frontmatter: { aliases: 'hello, world' }
			}));

			await fileIndex.ensureIndexed();

			const helloResults = fileIndex.search('hello', {}, 10);
			const worldResults = fileIndex.search('world', {}, 10);

			expect(helloResults.some(result =>
				result.matchType === 'alias' && result.displayText === 'hello'
			)).toBe(true);
			expect(worldResults.some(result =>
				result.matchType === 'alias' && result.displayText === 'world'
			)).toBe(true);
		});

		it('should read aliases from case-insensitive keys', async () => {
			const files = [
				{
					path: 'upper.md',
					basename: 'upper',
					extension: 'md',
					parent: { path: '' },
					stat: { mtime: Date.now() }
				},
				{
					path: 'note.md',
					basename: 'note',
					extension: 'md',
					parent: { path: '' },
					stat: { mtime: Date.now() }
				}
			] as TFile[];

			(mockApp.vault.getMarkdownFiles as any).mockReturnValue(files);
			mockApp.metadataCache.getFileCache = vi.fn((file) => {
				if (file.path === 'upper.md') {
					return { frontmatter: { Aliases: ['Caps'] } };
				}
				if (file.path === 'note.md') {
					return { frontmatter: { aLiAs: 'Mixed' } };
				}
				return { frontmatter: {} };
			});

			await fileIndex.ensureIndexed();

			const capsResults = fileIndex.search('caps', {}, 10);
			const mixedResults = fileIndex.search('mixed', {}, 10);

			expect(capsResults.some(result =>
				result.matchType === 'alias' && result.displayText === 'Caps'
			)).toBe(true);
			expect(mixedResults.some(result =>
				result.matchType === 'alias' && result.displayText === 'Mixed'
			)).toBe(true);
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
		itPerf('should handle large vaults efficiently', async () => {
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

describe('FileIndex recency accessors (note-picker seam)', () => {
	let mockApp: App;
	let fileIndex: FileIndex;
	let fireFileOpen: (file: TFile | null) => void;

	beforeEach(() => {
		TestableFileIndex.reset();
		mockApp = createMockApp();
		// Capture the 'file-open' handler the index registers so we can drive it.
		(mockApp.workspace.on as unknown as ReturnType<typeof vi.fn>) = vi.fn(
			(event: string, handler: (file: TFile | null) => void) => {
				if (event === 'file-open') fireFileOpen = handler;
				return {} as never;
			},
		);
		const mockPlugin = {
			registerEvent: vi.fn((eventRef) => eventRef),
		} as any;
		fileIndex = FileIndex.getInstance(mockApp, mockPlugin);
	});

	it('getInstanceIfExists returns the singleton, and undefined after reset', () => {
		expect(FileIndex.getInstanceIfExists()).toBe(fileIndex);
		TestableFileIndex.reset();
		expect(FileIndex.getInstanceIfExists()).toBeUndefined();
	});

	it('getLastOpenedAt reports the open timestamp and undefined for unopened files', () => {
		expect(typeof fireFileOpen).toBe('function');
		expect(fileIndex.getLastOpenedAt('Opened.md')).toBeUndefined();

		fireFileOpen({ path: 'Opened.md' } as TFile);

		expect(typeof fileIndex.getLastOpenedAt('Opened.md')).toBe('number');
		expect(fileIndex.getLastOpenedAt('Never.md')).toBeUndefined();
	});

	it('getLastOpenedAt is a non-mutating peek (stable across repeated reads)', () => {
		fireFileOpen({ path: 'A.md' } as TFile);
		const first = fileIndex.getLastOpenedAt('A.md');
		const second = fileIndex.getLastOpenedAt('A.md');
		expect(first).toBe(second);
		expect(typeof first).toBe('number');
	});

	it('a full reindex does not reorder the recency LRU (createIndexedFile peeks)', async () => {
		// Open order establishes recency: A (oldest) -> B -> C (newest).
		fireFileOpen({ path: 'A.md' } as TFile);
		fireFileOpen({ path: 'B.md' } as TFile);
		fireFileOpen({ path: 'C.md' } as TFile);

		const lruKeys = () =>
			Array.from(
				(
					(fileIndex as unknown as {
						recentFiles: { cache: Map<string, number> };
					}).recentFiles.cache
				).keys(),
			);
		expect(lruKeys()).toEqual(['A.md', 'B.md', 'C.md']);

		// Vault iteration order intentionally differs from open order. With the
		// mutating get() bug, reindexing each file rewrites the LRU to this order,
		// leaving C.md (not A.md) as the next eviction victim.
		const makeFile = (path: string): TFile =>
			({
				path,
				basename: path.replace(/\.md$/, ''),
				extension: 'md',
				parent: { path: '' },
				stat: { mtime: 1 },
			}) as unknown as TFile;
		(mockApp.vault.getMarkdownFiles as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
			makeFile('C.md'),
			makeFile('B.md'),
			makeFile('A.md'),
		]);
		mockApp.metadataCache.getFileCache = vi.fn(() => ({}));

		await fileIndex.ensureIndexed();

		// Recency order is preserved: A.md is still the oldest / next-evicted.
		expect(lruKeys()).toEqual(['A.md', 'B.md', 'C.md']);
		// And openedAt values survive the reindex unchanged.
		expect(typeof fileIndex.getFile('A.md')?.openedAt).toBe('number');
	});
});

describe('FileIndex reindex atomicity (concurrent vault mutations)', () => {
	let mockApp: App;
	let fileIndex: FileIndex;
	// Captured vault event handlers (create/delete/rename) so a test can fire a
	// mutation at a controlled moment: mid-reindex, between batch yields.
	let vaultHandlers: Record<string, (file: TFile, oldPath?: string) => void>;

	// A real TFile instance (not a cast): the create/delete/rename handlers guard
	// with `instanceof TFile`, so a plain object would be silently ignored.
	const mdFile = (path: string): TFile =>
		Object.assign(new TFile(), {
			path,
			basename: (path.replace(/\.md$/, '').split('/').pop() ?? path),
			extension: 'md',
			parent: { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' },
			stat: { mtime: 1 },
		});

	beforeEach(() => {
		vi.useFakeTimers();
		vaultHandlers = {};
		TestableFileIndex.reset();
		mockApp = createMockApp();
		// Capture the vault listeners the index registers during construction.
		(mockApp.vault.on as unknown as ReturnType<typeof vi.fn>) = vi.fn(
			(event: string, handler: (file: TFile, oldPath?: string) => void) => {
				vaultHandlers[event] = handler;
				return {} as never;
			},
		);
		mockApp.metadataCache.getFileCache = vi.fn(() => ({
			frontmatter: {},
			headings: [],
			tags: [],
		}));
		const mockPlugin = { registerEvent: vi.fn((ref) => ref) } as any;
		fileIndex = FileIndex.getInstance(mockApp, mockPlugin);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// Drives performReindex() to the point where it has snapshotted the vault and
	// is parked on its first setTimeout(0) yield, then runs `duringWindow` (the
	// concurrent mutation), then flushes the remaining yields and the swap+replay.
	const reindexWith = async (
		initial: TFile[],
		duringWindow: () => void,
	): Promise<void> => {
		(mockApp.vault.getMarkdownFiles as any).mockReturnValue(initial);
		const done = fileIndex.ensureIndexed(); // runs synchronously up to first yield
		duringWindow();
		await vi.runAllTimersAsync();
		await done;
	};

	it('keeps a file CREATED during the async reindex window', async () => {
		await reindexWith([mdFile('a.md'), mdFile('b.md')], () => {
			vaultHandlers.create(mdFile('c.md'));
		});

		// Without the fix the create mutated the about-to-be-discarded old map and
		// was suppressed by the isIndexing guard, so c.md vanished from the index.
		expect(fileIndex.getFile('c.md')).toBeDefined();
		expect(fileIndex.getIndexedFileCount()).toBe(3);
	});

	it('drops a file DELETED during the async reindex window', async () => {
		await reindexWith([mdFile('a.md'), mdFile('b.md')], () => {
			vaultHandlers.delete(mdFile('b.md'));
		});

		// Without the fix b.md was already in the snapshot/newFileMap and the
		// concurrent delete was lost, leaving a stale ghost entry in the picker.
		expect(fileIndex.getFile('b.md')).toBeUndefined();
		expect(fileIndex.getIndexedFileCount()).toBe(1);
	});

	it('reflects a RENAME that lands during the async reindex window', async () => {
		await reindexWith([mdFile('old.md'), mdFile('keep.md')], () => {
			vaultHandlers.rename(mdFile('new.md'), 'old.md');
		});

		expect(fileIndex.getFile('old.md')).toBeUndefined();
		expect(fileIndex.getFile('new.md')).toBeDefined();
		expect(fileIndex.getIndexedFileCount()).toBe(2);
	});

	it('survives mutations fired between intermediate reindex batches (>50 files)', async () => {
		// 60 files => 2 batches => a genuine intermediate setTimeout(0) yield, so
		// the mutations land mid-build rather than only at the final yield.
		const many = Array.from({ length: 60 }, (_, i) => mdFile(`f${i}.md`));
		await reindexWith(many, () => {
			vaultHandlers.create(mdFile('mid.md'));
			vaultHandlers.delete(many[3]); // delete an already-snapshotted file
		});

		expect(fileIndex.getFile('mid.md')).toBeDefined();
		expect(fileIndex.getFile('f3.md')).toBeUndefined();
		expect(fileIndex.getIndexedFileCount()).toBe(60); // 60 - 1 deleted + 1 created
	});

	it('keeps a mid-build create even when the reindex itself throws', async () => {
		// 60 files so the throw happens in the SECOND batch, after a real yield.
		const files = Array.from({ length: 60 }, (_, i) => mdFile(`f${i}.md`));
		(mockApp.vault.getMarkdownFiles as any).mockReturnValue(files);
		mockApp.metadataCache.getFileCache = vi.fn((file: TFile) => {
			if (file.path === 'f55.md') throw new Error('boom'); // build fails post-yield
			return { frontmatter: {}, headings: [], tags: [] };
		});

		const done = fileIndex.ensureIndexed();
		const settled = expect(done).rejects.toThrow('boom');
		vaultHandlers.create(mdFile('rescued.md')); // fires during the first yield
		await vi.runAllTimersAsync();
		await settled;

		// The reindex failed and never swapped, but because the handler applied to
		// the still-live map (not only the discarded buffer), the concurrent create
		// is not lost - and buffering is disarmed so later mutations resume normally.
		expect(fileIndex.getFile('rescued.md')).toBeDefined();
		expect(
			(fileIndex as unknown as { reindexBuffer: unknown }).reindexBuffer,
		).toBeNull();

		// And the error path reconciled Fuse with fileMap: a fuzzy-only query (one
		// the exact/prefix/substring tiers miss) still finds the rescued file, so
		// fuzzy search does not diverge from the fileMap-scanning tiers.
		const fuzzyHit = fileIndex
			.search('rescd')
			.some((r) => r.file.path === 'rescued.md');
		expect(fuzzyHit).toBe(true);
	});

	it('coalesces a create-then-delete within the window to nothing', async () => {
		await reindexWith([mdFile('a.md')], () => {
			vaultHandlers.create(mdFile('tmp.md'));
			vaultHandlers.delete(mdFile('tmp.md'));
		});

		expect(fileIndex.getFile('tmp.md')).toBeUndefined();
		expect(fileIndex.getIndexedFileCount()).toBe(1);
	});

	it('leaves no buffer behind after the reindex completes (normal path resumes)', async () => {
		await reindexWith([mdFile('a.md')], () => {});

		const internals = fileIndex as unknown as {
			reindexBuffer: unknown;
			pendingFuseUpdates: Map<string, unknown>;
		};
		expect(internals.reindexBuffer).toBeNull();

		// A post-reindex create now takes the normal incremental path again.
		vaultHandlers.create(mdFile('later.md'));
		expect(internals.pendingFuseUpdates.has('later.md')).toBe(true);
		expect(fileIndex.getFile('later.md')).toBeDefined();
	});
});
