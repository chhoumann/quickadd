import type { App, Plugin } from "obsidian";
import { TFile } from "obsidian";
import Fuse from "fuse.js";
import { createIndexedFile } from "./fileMetadata";
import { calculateFileScore, SearchWeights } from "./fileSearchRanking";
import type { SearchWeightsConfig } from "./fileSearchRanking";
export { SearchWeights, type SearchWeightsConfig } from "./fileSearchRanking";
import { normalizeForSearch } from "./utils";

export interface IndexedFile {
	path: string;
	pathNormalized: string;
	basename: string;
	basenameNormalized: string;
	aliases: string[];
	aliasesNormalized: string[];
	headings: string[];
	blockIds: string[];
	tags: string[];
	modified: number;
	openedAt?: number;
	folder: string;
}

export interface SearchContext {
	currentFile?: TFile;
	currentFolder?: string;
	recentFiles?: TFile[];
}

export interface SearchResult {
	file: IndexedFile;
	score: number;
	matchType: 'exact' | 'alias' | 'fuzzy' | 'unresolved' | 'heading' | 'block';
	displayText: string;
}

class LRUCache<T> {
	private cache = new Map<string, T>();
	private maxSize: number;

	constructor(maxSize = 100) {
		this.maxSize = maxSize;
	}

	/**
	 * Reads a value without affecting recency ordering. This is the ONLY read
	 * accessor: recency must be promoted exclusively by real file-open events via
	 * set(), never by index reads. A mutating get() was deliberately removed - it
	 * reordered the LRU to vault-iteration order during reindex (see git history).
	 */
	peek(key: string): T | undefined {
		return this.cache.get(key);
	}

	set(key: string, value: T): void {
		if (this.cache.has(key)) {
			this.cache.delete(key);
		} else if (this.cache.size >= this.maxSize) {
			// Remove least recently used (first item)
			const firstKey = this.cache.keys().next().value;
			this.cache.delete(firstKey);
		}
		this.cache.set(key, value);
	}

	clear(): void {
		this.cache.clear();
	}
}

// Constants for optimization thresholds
const MAX_INCREMENTAL_UPDATES = 20;
const FUSE_UPDATE_DEBOUNCE_MS = 100;

// Regex to test if a character is alphanumeric (used for word boundary detection)
const ALPHANUMERIC_REGEX = /\w/;


export class FileIndex {
	protected static instance: FileIndex;
	private app: App;
	private plugin: Plugin;
	private fileMap: Map<string, IndexedFile> = new Map();
	private fuseStrict: Fuse<IndexedFile>;
	private fuseRelaxed: Fuse<IndexedFile>;
	private recentFiles = new LRUCache<number>();
	private unresolvedLinks: Set<string> = new Set();
	private unresolvedLinksDirty = true;
	private isIndexing = false;
	private indexPromise: Promise<void> | null = null;
	private reindexTimeout: number | null = null;
	private fuseUpdateTimeout: number | null = null;
	private pendingFuseUpdates: Map<string, 'add' | 'update' | 'remove'> = new Map();
	// Vault mutations (create/rename/delete/metadata-change) captured while a full
	// reindex is building the replacement map. Non-null ONLY during
	// performReindex(): the mutation handlers record into it (in addition to their
	// normal work) so performReindex() can replay them onto the new map before
	// rebuilding Fuse. See performReindex() for the full rationale.
	private reindexBuffer: Map<string, { op: 'upsert' | 'remove'; file?: TFile }> | null = null;
	private effectiveWeights: SearchWeightsConfig = SearchWeights;

	protected constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
		
		const fuseConfig = {
			keys: [
				{ name: 'basenameNormalized', weight: 0.8 }, // Prioritize basename matches
				{ name: 'aliasesNormalized', weight: 0.6 },  // Reduced from 1.0
				{ name: 'pathNormalized', weight: 0.2 }
			],
			ignoreLocation: true,
			findAllMatches: true,
			shouldSort: false, // We'll handle sorting ourselves
			includeMatches: true // Include match information to detect alias hits
		};

		this.fuseStrict = new Fuse<IndexedFile>([], {
			...fuseConfig,
			threshold: 0.2
		});

		this.fuseRelaxed = new Fuse<IndexedFile>([], {
			...fuseConfig,
			threshold: 0.4
		});

		this.setupEventListeners();
		// Just use the default weights - they're already optimal
		this.effectiveWeights = SearchWeights;
	}


	static getInstance(app: App, plugin: Plugin): FileIndex {
		if (!FileIndex.instance) {
			FileIndex.instance = new FileIndex(app, plugin);
		}
		return FileIndex.instance;
	}

	/**
	 * Returns the existing singleton without constructing one. Lets recency-aware
	 * callers (e.g. the capture note-picker) reuse the index when it is already
	 * warm, without paying any startup/indexing cost when it is not.
	 */
	static getInstanceIfExists(): FileIndex | undefined {
		return FileIndex.instance ?? undefined;
	}

	/**
	 * Session recency for a path: the timestamp it was last opened this session, or
	 * undefined if never opened. Sourced from the file-open listener's LRU, so it is
	 * available regardless of whether the search index has finished building.
	 */
	getLastOpenedAt(path: string): number | undefined {
		return this.recentFiles.peek(path);
	}


	private setupEventListeners(): void {
		// Track recently opened files
		this.plugin.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (file) {
					this.recentFiles.set(file.path, Date.now());
					// Update openedAt in our index
					const indexedFile = this.fileMap.get(file.path);
					if (indexedFile) {
						indexedFile.openedAt = Date.now();
					}
				}
			})
		);

		// Incremental metadata updates for better performance
		this.plugin.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.updateFile(file);
				}
			})
		);

		// Fallback for resolved event (less frequent, full reindex only if needed)
		this.plugin.registerEvent(
			this.app.metadataCache.on('resolved', () => {
				this.unresolvedLinksDirty = true;
				// Only schedule reindex if we don't have any files indexed yet
				if (this.fileMap.size === 0) {
					this.scheduleReindex();
				}
			})
		);

		// Handle file system changes
		this.plugin.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.addFile(file);
				}
			})
		);

		this.plugin.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) {
					this.removeFile(file);
				}
			})
		);

		this.plugin.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.removeFileByPath(oldPath);
					this.addFile(file);
				}
			})
		);
	}

	async ensureIndexed(): Promise<void> {
		if (this.isIndexing && this.indexPromise) {
			return this.indexPromise;
		}

		if (this.fileMap.size === 0) {
			return this.reindex();
		}
	}

	private scheduleReindex(): void {
		// Debounce reindexing
		if (this.reindexTimeout !== null) {
			window.clearTimeout(this.reindexTimeout);
		}
		this.reindexTimeout = window.setTimeout(() => {
			void this.reindex();
		}, 500);
	}

	private async reindex(): Promise<void> {
		if (this.isIndexing && this.indexPromise) return this.indexPromise;

		this.isIndexing = true;
		this.indexPromise = this.performReindex();
		
		try {
			await this.indexPromise;
		} finally {
			this.isIndexing = false;
			this.indexPromise = null;
		}
	}

	private async performReindex(): Promise<void> {
		// Record vault mutations (create/rename/delete/metadata-change) that fire
		// while we yield to the event loop below, so we can replay them onto the
		// replacement map after the swap. The handlers keep mutating the live
		// (old) map too: on success the old map is discarded and only the replay
		// matters, but if the build throws before the swap the old map - still
		// live - already holds them, so nothing is lost on the error path either.
		// Without this, a file created/deleted mid-build vanished at the swap
		// (scheduleFuseUpdate also suppresses incremental updates while indexing).
		const buffer = new Map<string, { op: 'upsert' | 'remove'; file?: TFile }>();
		this.reindexBuffer = buffer;
		try {
			const files = this.app.vault.getMarkdownFiles();
			const newFileMap = new Map<string, IndexedFile>();

			// Use requestIdleCallback for better performance if available
			const processInBatches = async (items: TFile[], batchSize = 50) => {
				for (let i = 0; i < items.length; i += batchSize) {
					const batch = items.slice(i, i + batchSize);

					for (const file of batch) {
						const indexedFile = this.createIndexedFile(file);
						newFileMap.set(file.path, indexedFile);
					}

					// Yield control back to the event loop
					await new Promise(resolve => window.setTimeout(resolve, 0));
				}
			};

			await processInBatches(files);

			this.fileMap = newFileMap;
			// Replay concurrent mutations onto the fresh map BEFORE rebuilding
			// Fuse, coalesced last-write-wins per path (an add-then-delete
			// collapses to a delete; a rename's remove+add lands as both). The
			// subsequent updateFuseIndex() rebuilds Fuse from the corrected map.
			for (const [path, mutation] of buffer) {
				if (mutation.op === 'remove') {
					this.fileMap.delete(path);
				} else if (mutation.file) {
					this.fileMap.set(path, this.createIndexedFile(mutation.file));
				}
			}
			this.updateFuseIndex();
			this.updateUnresolvedLinks();
		} catch (error) {
			// The build threw before the Fuse rebuild above. The mutation handlers
			// applied their changes to the still-live fileMap, but their incremental
			// Fuse updates were suppressed while indexing - so reconcile Fuse with
			// fileMap now. Otherwise fuzzy search (which queries Fuse) would diverge
			// from the exact/prefix tiers (which scan fileMap) until the next
			// reindex. Best-effort: never let this mask the original failure.
			try {
				this.updateFuseIndex();
			} catch {
				/* leave Fuse as-is; the original error is what matters */
			}
			throw error;
		} finally {
			this.reindexBuffer = null;
		}
	}

	private createIndexedFile(file: TFile): IndexedFile {
		return createIndexedFile(this.app, file, this.recentFiles.peek(file.path));
	}

	private addFile(file: TFile): void {
		this.upsertFile(file, 'add');
	}

	private updateFile(file: TFile): void {
		this.upsertFile(file, 'update');
		this.unresolvedLinksDirty = true;
	}

	private upsertFile(file: TFile, operation: 'add' | 'update'): void {
		this.fileMap.set(file.path, this.createIndexedFile(file));
		this.scheduleFuseUpdate(file.path, operation);
		this.reindexBuffer?.set(file.path, { op: 'upsert', file });
	}

	private removeFile(file: TFile): void {
		this.removeFileByPath(file.path);
	}

	private removeFileByPath(path: string): void {
		this.fileMap.delete(path);
		this.scheduleFuseUpdate(path, 'remove');
		this.reindexBuffer?.set(path, { op: 'remove' });
	}

	private updateFuseIndex(): void {
		const files = Array.from(this.fileMap.values());
		this.fuseStrict.setCollection(files);
		this.fuseRelaxed.setCollection(files);
	}

	private scheduleFuseUpdate(path: string, operation: 'add' | 'update' | 'remove'): void {
		// If we're doing a full reindex, don't bother with incremental updates
		if (this.isIndexing) return;

		const existingOp = this.pendingFuseUpdates.get(path);
		if (existingOp === 'add' && operation === 'remove') {
			this.pendingFuseUpdates.delete(path);
			return;
		}
		this.pendingFuseUpdates.set(path,
			existingOp === 'remove' && operation === 'add' ? 'update' : operation);

		// Clear existing timeout
		if (this.fuseUpdateTimeout !== null) {
			window.clearTimeout(this.fuseUpdateTimeout);
		}

		// Debounce updates on the renderer window for Obsidian popout compatibility.
		this.fuseUpdateTimeout = window.setTimeout(() => {
			this.processPendingFuseUpdates();
		}, FUSE_UPDATE_DEBOUNCE_MS);
	}

	private processPendingFuseUpdates(): void {
		if (this.pendingFuseUpdates.size === 0) return;
		
		// Guard against concurrent full reindex
		if (this.isIndexing) {
			this.pendingFuseUpdates.clear();
			return;
		}

		// If we have too many pending updates, just do a full rebuild
		// This threshold prevents performance degradation with many individual updates
		if (this.pendingFuseUpdates.size > MAX_INCREMENTAL_UPDATES) {
			this.updateFuseIndex();
			this.pendingFuseUpdates.clear();
			return;
		}

		for (const [path, operation] of this.pendingFuseUpdates) {
			// Fuse updates replace the old document to avoid duplicates.
			for (const index of [this.fuseStrict, this.fuseRelaxed]) {
				index.remove((doc) => doc.path === path);
				const file = operation !== 'remove' && this.fileMap.get(path);
				if (file) index.add(file);
			}
		}

		this.pendingFuseUpdates.clear();
	}

	private updateUnresolvedLinks(): void {
		const unresolvedLinks = this.app.metadataCache.unresolvedLinks;
		this.unresolvedLinks.clear();

		for (const sourceFile in unresolvedLinks) {
			for (const link in unresolvedLinks[sourceFile]) {
				this.unresolvedLinks.add(link);
			}
		}

		this.unresolvedLinksDirty = false;
	}

	search(query: string, context: SearchContext = {}, limit = 50): SearchResult[] {
		if (this.unresolvedLinksDirty) {
			this.updateUnresolvedLinks();
		}

		if (query.includes('#')) return this.searchWithHeadings(query, context, limit);
		const queryNormalized = normalizeForSearch(query);
		const results = this.matchFiles(query, context, limit);

		// 4. Unresolved links - Tier 3
		if (query.length >= 2) {
			let unresolvedCount = 0;
			const unresolvedLimit = query.length < 3 ? 10 : 20;
			
			for (const unresolvedLink of this.unresolvedLinks) {
				if (unresolvedCount >= unresolvedLimit) break;
				
				if (normalizeForSearch(unresolvedLink).includes(queryNormalized)) {
					results.push({
						file: {
							path: unresolvedLink,
							pathNormalized: normalizeForSearch(unresolvedLink),
							basename: unresolvedLink,
							basenameNormalized: normalizeForSearch(unresolvedLink),
							aliases: [],
							aliasesNormalized: [],
							headings: [],
							blockIds: [],
							tags: [],
							modified: 0,
							folder: ""
						},
						score: this.effectiveWeights.base.unresolvedLink,
						matchType: 'unresolved',
						displayText: unresolvedLink
					});
					unresolvedCount++;
				}
			}
		}

		// Sort by score and limit results
		return results
			.sort((a, b) => a.score - b.score)
			.slice(0, limit);
	}

	private calculateScore(file: IndexedFile, query: string, context: SearchContext, baseScore: number, matchType?: string): number {
		return calculateFileScore(file, query, context, baseScore, this.effectiveWeights,
			context.currentFile ? this.fileMap.get(context.currentFile.path) : undefined, matchType);
	}

	private searchWithHeadings(query: string, context: SearchContext, limit: number): SearchResult[] {
		const [filePart, headingPartRaw] = query.split('#');
		const headingPart = normalizeForSearch(headingPartRaw ?? "");
		const results: SearchResult[] = [];

		// Prevent infinite recursion by doing a simple search if no file part
		if (filePart === '') {
			// Global heading search - search all files with performance limit
			let resultCount = 0;
			const maxResults = 200; // Performance guard for large vaults
			const allFiles = Array.from(this.fileMap.values());
			
			for (const file of allFiles) {
				if (resultCount >= maxResults) break;
				
				for (const heading of file.headings) {
					if (resultCount >= maxResults) break;
					
					if (normalizeForSearch(heading).includes(headingPart)) {
						results.push({
							file,
							score: this.calculateScore(file, query, context, 0.1),
							matchType: 'heading',
							displayText: `${file.basename}#${heading}`
						});
						resultCount++;
					}
				}
			}
		} else {
			// File-specific heading search - use direct search to avoid recursion
			const fileResults = this.searchFiles(filePart, context, limit);
			if (fileResults.length === 0) return [];
			
			for (const fileResult of fileResults) {
				for (const heading of fileResult.file.headings) {
					if (normalizeForSearch(heading).includes(headingPart)) {
						results.push({
							file: fileResult.file,
							score: fileResult.score + 0.05,
							matchType: 'heading',
							displayText: `${fileResult.file.basename}#${heading}`
						});
					}
				}
			}
		}

		return results
			.sort((a, b) => a.score - b.score)
			.slice(0, limit);
	}

	private searchFiles(query: string, context: SearchContext, limit: number): SearchResult[] {
		// Heading lookup retains its fixed basename/prefix ranking.
		return this.matchFiles(query, context, limit, {
			...this.effectiveWeights.base,
			basenameExact: -1000,
			basenamePrefix: -500,
			aliasPrefix: -500,
			substringBasename: -300,
		}).sort((a, b) => a.score - b.score).slice(0, limit);
	}

	private matchFiles(
		query: string,
		context: SearchContext,
		limit: number,
		weights = this.effectiveWeights.base,
	): SearchResult[] {
		const results: SearchResult[] = [];
		const queryNormalized = normalizeForSearch(query);
		const addedPaths = new Set<string>();
		const allFiles = Array.from(this.fileMap.values());
		const add = (
			file: IndexedFile, base: number,
			matchType: SearchResult['matchType'], displayText: string,
		) => {
			if (addedPaths.has(file.path)) return;
			results.push({
				file, score: this.calculateScore(file, query, context, base, matchType),
				matchType, displayText,
			});
			addedPaths.add(file.path);
		};

		// Keep separate passes: earlier tiers win, and ties retain vault order.
		for (const file of allFiles) {
			if (file.basenameNormalized === queryNormalized) add(file, weights.basenameExact, 'exact', file.basename);
		}
		for (const file of allFiles) {
			const index = file.aliasesNormalized.indexOf(queryNormalized);
			if (index !== -1) add(file, weights.aliasExact, 'alias', file.aliases[index]);
		}
		for (const file of allFiles) {
			if (file.basenameNormalized.startsWith(queryNormalized)) add(file, weights.basenamePrefix, 'fuzzy', file.basename);
		}
		for (const file of allFiles) {
			const index = file.aliasesNormalized.findIndex(alias => alias.startsWith(queryNormalized));
			if (index !== -1) add(file, weights.aliasPrefix, 'alias', file.aliases[index]);
		}
		for (const file of allFiles) {
			const index = file.basenameNormalized.indexOf(queryNormalized);
			if (index > 0 && !ALPHANUMERIC_REGEX.test(file.basenameNormalized[index - 1])) {
				add(file, weights.substringBasename, 'fuzzy', file.basename);
			}
		}

		// 3. Fuzzy search with adaptive threshold - Tier 3 and below
		let fuseResults = this.fuseStrict.search(queryNormalized, { limit: limit * 2 });

		// Relax threshold if we have too few results
		if (fuseResults.length < this.effectiveWeights.thresholds.fuzzyRelaxCount) {
			fuseResults = this.fuseRelaxed.search(queryNormalized, { limit: limit * 2 });
		}

		for (const result of fuseResults) {
			// Defensive: skip malformed Fuse results
			if (!result || !result.item || !result.item.path) {
				continue;
			}

			// Skip if already added
			if (addedPaths.has(result.item.path)) {
				continue;
			}

			// Detect if this Fuse result came from an alias match
			const aliasMatch = (result.matches ?? []).find(m => m.key === 'aliasesNormalized');
			const fromAlias = Boolean(aliasMatch);
			const matchType = fromAlias ? 'alias' : 'fuzzy';
			let displayText = result.item.basename;
			if (fromAlias) {
				const matchedAlias = typeof aliasMatch?.value === "string" ? aliasMatch.value : undefined;
				const aliasIndex = matchedAlias
					? result.item.aliasesNormalized.findIndex(alias => alias === matchedAlias)
					: result.item.aliasesNormalized.findIndex(alias => alias.includes(queryNormalized));
				if (aliasIndex >= 0) {
					displayText = result.item.aliases[aliasIndex];
				}
			}

			add(result.item, (result.score ?? 0.5) + weights.fuzzyMatch, matchType, displayText);
		}

		return results;
	}

	getFile(path: string): IndexedFile | undefined {
		return this.fileMap.get(path);
	}

	getHeadings(file: IndexedFile): string[] {
		return file.headings;
	}

	getBlockIds(file: IndexedFile): string[] {
		return file.blockIds;
	}

	/**
	 * Get the count of indexed files (for testing)
	 */
	getIndexedFileCount(): number {
		return this.fileMap.size;
	}


}
