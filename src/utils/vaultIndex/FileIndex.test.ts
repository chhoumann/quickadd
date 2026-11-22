import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FileIndex } from './FileIndex';
import { TFile } from 'obsidian';
import type { App, CachedMetadata, Plugin } from 'obsidian';

interface NoteSpec {
	path: string;
	aliases?: string[] | string;
	headings?: string[];
	tags?: string[];
}

// A real TFile instance (not a cast): the vault event handlers guard with
// `instanceof TFile`, so a plain object would be silently ignored.
const mdFile = (path: string): TFile =>
	Object.assign(new TFile(), {
		path,
		basename: path.replace(/\.md$/, '').split('/').pop() ?? path,
		extension: 'md',
		parent: { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' },
		stat: { mtime: 1 },
	});

const metadataFor = (spec: NoteSpec | undefined): CachedMetadata => ({
	frontmatter: spec?.aliases === undefined ? {} : { aliases: spec.aliases },
	headings: (spec?.headings ?? []).map((heading, i) => ({
		heading,
		level: 1,
		position: {
			start: { line: i, col: 0, offset: 0 },
			end: { line: i, col: heading.length, offset: heading.length },
		},
	})),
	tags: (spec?.tags ?? []).map((tag) => ({
		tag,
		position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } },
	})),
});

type Handler = (...args: unknown[]) => void;

/**
 * A fake vault whose files and metadata the test controls, plus the event
 * handlers the index registers, so tests drive it the way Obsidian does.
 */
function createVault() {
	let notes: NoteSpec[] = [];
	const handlers: Record<string, Handler> = {};
	const on = (event: string, handler: Handler) => {
		handlers[event] = handler;
		return {};
	};
	const unresolvedLinks: Record<string, Record<string, number>> = {};
	let unresolvedLinkReads = 0;

	const app = {
		vault: {
			getMarkdownFiles: vi.fn(() => notes.map((note) => mdFile(note.path))),
			on,
		},
		metadataCache: {
			getFileCache: vi.fn((file: TFile) => metadataFor(notes.find((note) => note.path === file.path))),
			get unresolvedLinks() {
				unresolvedLinkReads++;
				return unresolvedLinks;
			},
			on,
		},
		workspace: { on },
	} as unknown as App;

	const plugin = { registerEvent: vi.fn((ref: unknown) => ref) } as unknown as Plugin;

	return {
		app,
		handlers,
		unresolvedLinks,
		unresolvedLinkReads: () => unresolvedLinkReads,
		setNotes(next: NoteSpec[]) {
			notes = next;
		},
		createIndex() {
			FileIndex.destroyInstance();
			return FileIndex.getInstance(app, plugin);
		},
	};
}

const paths = (results: { file: { path: string } }[]) => results.map((r) => r.file.path);

describe('FileIndex', () => {
	let vault: ReturnType<typeof createVault>;
	let fileIndex: FileIndex;

	const indexNotes = async (notes: NoteSpec[]) => {
		vault.setNotes(notes);
		await fileIndex.ensureIndexed();
	};

	beforeEach(() => {
		vault = createVault();
		fileIndex = vault.createIndex();
	});

	afterEach(() => {
		FileIndex.destroyInstance();
	});

	it('returns no results before indexing', () => {
		expect(fileIndex.search('test', {}, 10)).toEqual([]);
	});

	describe('ranking', () => {
		it('returns the exact basename match first', async () => {
			await indexNotes([{ path: 'contest.md' }, { path: 'testing.md' }, { path: 'test.md' }]);

			const [first] = fileIndex.search('test', {}, 10);

			expect(first.file.path).toBe('test.md');
			expect(first.matchType).toBe('exact');
		});

		it('ranks a note in the current folder above same-named notes elsewhere', async () => {
			await indexNotes([{ path: 'folder2/note.md' }, { path: 'note.md' }, { path: 'folder1/note.md' }]);

			const results = fileIndex.search('note', { currentFolder: 'folder1' }, 10);

			expect(paths(results)[0]).toBe('folder1/note.md');
			const score = (path: string) => results.find((r) => r.file.path === path)!.score;
			expect(score('folder1/note.md')).toBeLessThan(score('folder2/note.md'));
		});

		it('ranks a note sharing tags with the current file above an otherwise equal note', async () => {
			await indexNotes([
				{ path: 'current.md', tags: ['#shared'] },
				{ path: 'note-plain.md' },
				{ path: 'note-tagd.md', tags: ['#shared', '#other'] },
			]);

			const results = fileIndex.search('note', { currentFile: mdFile('current.md') }, 10);

			expect(paths(results).slice(0, 2)).toEqual(['note-tagd.md', 'note-plain.md']);
		});

		it('scores an alias match worse than an equal basename match', async () => {
			await indexNotes([
				{ path: 'random.md', aliases: ['project-x'] },
				{ path: 'project-y.md' },
			]);

			const results = fileIndex.search('project', {}, 10);
			const basenameHit = results.find((r) => r.file.path === 'project-y.md')!;
			const aliasHit = results.find((r) => r.file.path === 'random.md')!;

			expect(aliasHit.matchType).toBe('alias');
			expect(aliasHit.displayText).toBe('project-x');
			expect(aliasHit.score).toBeGreaterThan(basenameHit.score);
		});

		it('returns alias prefix matches before fuzzy results', async () => {
			await indexNotes([
				{ path: 'fuzzy-match.md' },
				{ path: 'random.md', aliases: ['alias-match'] },
				{ path: 'another.md', aliases: ['alice'] },
			]);

			const results = fileIndex.search('ali', {}, 10);

			// Equal-score alias hits keep vault order.
			expect(results.slice(0, 2).map((r) => [r.file.path, r.matchType, r.displayText])).toEqual([
				['random.md', 'alias', 'alias-match'],
				['another.md', 'alias', 'alice'],
			]);
			expect(results.slice(2).every((r) => r.matchType !== 'alias')).toBe(true);
		});

		it('matches a composed query against a decomposed filename', async () => {
			const nfdName = 'Rücken-Fit'.normalize('NFD');
			await indexNotes([{ path: `${nfdName}.md` }]);

			expect(paths(fileIndex.search('Rü', {}, 10))).toEqual([`${nfdName}.md`]);
		});
	});

	describe('aliases', () => {
		it('splits comma-separated alias strings', async () => {
			await indexNotes([{ path: 'test.md', aliases: 'hello, world' }]);

			expect(fileIndex.search('hello', {}, 10)[0]).toMatchObject({ matchType: 'alias', displayText: 'hello' });
			expect(fileIndex.search('world', {}, 10)[0]).toMatchObject({ matchType: 'alias', displayText: 'world' });
		});

		it('reads aliases from case-insensitive frontmatter keys', async () => {
			vault.setNotes([{ path: 'upper.md' }, { path: 'note.md' }]);
			vi.mocked(vault.app.metadataCache.getFileCache).mockImplementation((file: TFile) =>
				file.path === 'upper.md'
					? { frontmatter: { Aliases: ['Caps'] } }
					: { frontmatter: { aLiAs: 'Mixed' } },
			);
			await fileIndex.ensureIndexed();

			expect(fileIndex.search('caps', {}, 10)[0]).toMatchObject({ matchType: 'alias', displayText: 'Caps' });
			expect(fileIndex.search('mixed', {}, 10)[0]).toMatchObject({ matchType: 'alias', displayText: 'Mixed' });
		});
	});

	describe('heading search', () => {
		beforeEach(async () => {
			await indexNotes([
				{ path: 'file1.md', headings: ['Introduction', 'My Heading', 'Conclusion'] },
				{ path: 'file2.md', headings: ['Overview', 'My Special Heading'] },
			]);
		});

		it('finds headings across all notes with a leading #', () => {
			const results = fileIndex.search('#my heading', {}, 10);

			expect(results.map((r) => [r.matchType, r.displayText])).toEqual([['heading', 'file1#My Heading']]);
		});

		it('finds headings inside the named note', () => {
			const results = fileIndex.search('file2#special', {}, 10);

			expect(results.map((r) => [r.matchType, r.displayText])).toEqual([['heading', 'file2#My Special Heading']]);
		});
	});

	describe('vault changes after indexing', () => {
		// Exact/prefix/substring tiers scan the file map; this query only reaches
		// the fuzzy (Fuse) tier, so it proves the fuzzy index was updated too.
		const fuzzyFinds = (query: string, path: string) =>
			paths(fileIndex.search(query, {}, 10)).includes(path);

		beforeEach(async () => {
			vi.useFakeTimers();
			vault.setNotes([{ path: 'file1.md' }, { path: 'file2.md' }]);
			const done = fileIndex.ensureIndexed();
			await vi.runAllTimersAsync();
			await done;
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('makes a created note fuzzy-searchable after the debounce', () => {
			vault.handlers.create(mdFile('rescued.md'));
			vi.advanceTimersByTime(150);

			expect(fileIndex.getFile('rescued.md')).toBeDefined();
			expect(fuzzyFinds('rescd', 'rescued.md')).toBe(true);
		});

		it('leaves no trace of a note created and deleted within the debounce', () => {
			vault.handlers.create(mdFile('rescued.md'));
			vault.handlers.delete(mdFile('rescued.md'));
			vi.advanceTimersByTime(150);

			expect(fileIndex.getFile('rescued.md')).toBeUndefined();
			expect(fuzzyFinds('rescd', 'rescued.md')).toBe(false);
		});

		it('moves a renamed note to its new path exactly once', () => {
			vault.handlers.create(mdFile('rescued.md'));
			vi.advanceTimersByTime(150);
			vault.handlers.rename(mdFile('archive/rescued.md'), 'rescued.md');
			vi.advanceTimersByTime(150);

			expect(paths(fileIndex.search('rescd', {}, 10)).filter((p) => p.includes('rescued'))).toEqual([
				'archive/rescued.md',
			]);
		});

		it('reads unresolved links lazily on search, not on every metadata change', () => {
			const readsBefore = vault.unresolvedLinkReads();
			vault.unresolvedLinks['file1.md'] = { 'Missing Note': 1 };

			for (let i = 0; i < 5; i++) vault.handlers.changed(mdFile('file1.md'));
			expect(vault.unresolvedLinkReads()).toBe(readsBefore);

			expect(fileIndex.search('missing', {}, 10)).toEqual([
				expect.objectContaining({ matchType: 'unresolved', displayText: 'Missing Note' }),
			]);
			expect(fileIndex.search('missing', {}, 10)).toHaveLength(1);
			expect(vault.unresolvedLinkReads()).toBe(readsBefore + 1);
		});
	});
});

describe('FileIndex recency (note-picker seam)', () => {
	let vault: ReturnType<typeof createVault>;
	let fileIndex: FileIndex;
	const open = (path: string) => vault.handlers['file-open'](mdFile(path));

	beforeEach(() => {
		vault = createVault();
		fileIndex = vault.createIndex();
	});

	afterEach(() => {
		FileIndex.destroyInstance();
	});

	it('getInstanceIfExists returns the singleton, and undefined after reset', () => {
		expect(FileIndex.getInstanceIfExists()).toBe(fileIndex);
		FileIndex.destroyInstance();
		expect(FileIndex.getInstanceIfExists()).toBeUndefined();
	});

	it('destroyInstance cancels a pending debounced reindex', () => {
		vi.useFakeTimers();
		try {
			// An empty index schedules a full reindex on 'resolved'.
			vault.handlers.resolved();
			FileIndex.destroyInstance();
			vi.advanceTimersByTime(1000);

			expect(vault.app.vault.getMarkdownFiles).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it('getLastOpenedAt reports the open timestamp and undefined for unopened files', () => {
		vi.useFakeTimers({ now: 1_700_000_000_000 });
		try {
			expect(fileIndex.getLastOpenedAt('Opened.md')).toBeUndefined();

			open('Opened.md');

			expect(fileIndex.getLastOpenedAt('Opened.md')).toBe(1_700_000_000_000);
			expect(fileIndex.getLastOpenedAt('Never.md')).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});

	it('a full reindex keeps open order, so the oldest-opened note is evicted first', async () => {
		// Open order establishes recency: A (oldest) -> B -> C (newest).
		open('A.md');
		open('B.md');
		open('C.md');

		// Vault iteration order intentionally differs from open order: reading
		// recency during the reindex must not promote files in vault order.
		vault.setNotes([{ path: 'C.md' }, { path: 'B.md' }, { path: 'A.md' }]);
		await fileIndex.ensureIndexed();
		expect(fileIndex.getFile('A.md')?.openedAt).toBe(fileIndex.getLastOpenedAt('A.md'));

		// The recency list holds 100 entries; 98 more opens evict exactly one.
		for (let i = 0; i < 98; i++) open(`other-${i}.md`);

		expect(fileIndex.getLastOpenedAt('A.md')).toBeUndefined();
		expect(fileIndex.getLastOpenedAt('B.md')).toBeDefined();
		expect(fileIndex.getLastOpenedAt('C.md')).toBeDefined();
	});
});

describe('FileIndex reindex atomicity (concurrent vault mutations)', () => {
	let vault: ReturnType<typeof createVault>;
	let fileIndex: FileIndex;

	beforeEach(() => {
		vi.useFakeTimers();
		vault = createVault();
		fileIndex = vault.createIndex();
	});

	afterEach(() => {
		FileIndex.destroyInstance();
		vi.useRealTimers();
	});

	// Drives performReindex() to the point where it has snapshotted the vault and
	// is parked on its first setTimeout(0) yield, then runs `duringWindow` (the
	// concurrent mutation), then flushes the remaining yields and the swap+replay.
	const reindexWith = async (initial: string[], duringWindow: () => void): Promise<void> => {
		vault.setNotes(initial.map((path) => ({ path })));
		const done = fileIndex.ensureIndexed(); // runs synchronously up to first yield
		duringWindow();
		await vi.runAllTimersAsync();
		await done;
	};

	it('keeps a file CREATED during the async reindex window', async () => {
		await reindexWith(['a.md', 'b.md'], () => {
			vault.handlers.create(mdFile('c.md'));
		});

		expect(fileIndex.getFile('c.md')).toBeDefined();
		expect(fileIndex.getIndexedFileCount()).toBe(3);
	});

	it('drops a file DELETED during the async reindex window', async () => {
		await reindexWith(['a.md', 'b.md'], () => {
			vault.handlers.delete(mdFile('b.md'));
		});

		expect(fileIndex.getFile('b.md')).toBeUndefined();
		expect(fileIndex.getIndexedFileCount()).toBe(1);
	});

	it('reflects a RENAME that lands during the async reindex window', async () => {
		await reindexWith(['old.md', 'keep.md'], () => {
			vault.handlers.rename(mdFile('new.md'), 'old.md');
		});

		expect(fileIndex.getFile('old.md')).toBeUndefined();
		expect(fileIndex.getFile('new.md')).toBeDefined();
		expect(fileIndex.getIndexedFileCount()).toBe(2);
	});

	it('survives mutations fired between intermediate reindex batches (>50 files)', async () => {
		// 60 files => 2 batches => a genuine intermediate setTimeout(0) yield, so
		// the mutations land mid-build rather than only at the final yield.
		const many = Array.from({ length: 60 }, (_, i) => `f${i}.md`);
		await reindexWith(many, () => {
			vault.handlers.create(mdFile('mid.md'));
			vault.handlers.delete(mdFile(many[3])); // delete an already-snapshotted file
		});

		expect(fileIndex.getFile('mid.md')).toBeDefined();
		expect(fileIndex.getFile('f3.md')).toBeUndefined();
		expect(fileIndex.getIndexedFileCount()).toBe(60); // 60 - 1 deleted + 1 created
	});

	it('keeps a mid-build create even when the reindex itself throws', async () => {
		// 60 files so the throw happens in the SECOND batch, after a real yield.
		vault.setNotes(Array.from({ length: 60 }, (_, i) => ({ path: `f${i}.md` })));
		vi.mocked(vault.app.metadataCache.getFileCache).mockImplementation((file: TFile) => {
			if (file.path === 'f55.md') throw new Error('boom'); // build fails post-yield
			return {};
		});

		const done = fileIndex.ensureIndexed();
		const settled = expect(done).rejects.toThrow('boom');
		vault.handlers.create(mdFile('rescued.md')); // fires during the first yield
		await vi.runAllTimersAsync();
		await settled;

		expect(fileIndex.getFile('rescued.md')).toBeDefined();
		// The error path reconciled Fuse with the file map: a fuzzy-only query (one
		// the exact/prefix/substring tiers miss) still finds the rescued file.
		expect(paths(fileIndex.search('rescd'))).toContain('rescued.md');

		// Indexing is over, so later mutations take the normal incremental path.
		vault.handlers.create(mdFile('later.md'));
		vi.advanceTimersByTime(150);
		expect(paths(fileIndex.search('latr'))).toContain('later.md');
	});

	it('coalesces a create-then-delete within the window to nothing', async () => {
		await reindexWith(['a.md'], () => {
			vault.handlers.create(mdFile('tmp.md'));
			vault.handlers.delete(mdFile('tmp.md'));
		});

		expect(fileIndex.getFile('tmp.md')).toBeUndefined();
		expect(fileIndex.getIndexedFileCount()).toBe(1);
	});

	it('resumes incremental fuzzy updates after the reindex completes', async () => {
		await reindexWith(['a.md'], () => {});

		vault.handlers.create(mdFile('later.md'));
		vi.advanceTimersByTime(150);

		expect(fileIndex.getFile('later.md')).toBeDefined();
		expect(paths(fileIndex.search('latr'))).toContain('later.md');
	});
});
