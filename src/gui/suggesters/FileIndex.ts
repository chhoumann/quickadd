import type { App, Plugin } from "obsidian";
import { TFile } from "obsidian";
import Fuse from "fuse.js";
import { normalizeForFuse, normalizeForSearch, sanitizeHeading } from "./utils";

export interface IndexedFile {
	path: string;
	basename: string;
	aliases: string[];
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

	get(key: string): T | undefined {
		const value = this.cache.get(key);
		if (value !== undefined) {
			// Move to end (most recently used)
			this.cache.delete(key);
			this.cache.set(key, value);
		}
		return value;
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

const normalizeFuseValue = (value: unknown): string | ReadonlyArray<string> => {
	if (typeof value === "string") return normalizeForFuse(value);
	if (Array.isArray(value)) {
		return value
			.filter((entry): entry is string => typeof entry === "string")
			.map((entry) => normalizeForFuse(entry));
	}
	return "";
};

const resolvePath = (obj: IndexedFile, path: string | string[]): unknown => {
	if (Array.isArray(path)) {
		return path.reduce((acc: any, key) => acc?.[key], obj as any);
	}
	if (path.includes(".")) {
		return path.split(".").reduce((acc: any, key) => acc?.[key], obj as any);
	}
	return (obj as any)[path];
};

const getFuseValue = (
	obj: IndexedFile,
	path: string | string[]
): string | ReadonlyArray<string> =>
	normalizeFuseValue(resolvePath(obj, path));

// Configurable search ranking weights
export const SearchWeights = {
	base: {
		basenameExact: -1000,
		aliasExact: -900,
		basenamePrefix: -500,
		aliasPrefix: -500,
		substringBasename: -300,
		fuzzyMatch: 0,
		unresolvedLink: 1000,
	},
	boosts: {
		sameFolder: -0.15,
		recency: -0.10,
		tagOverlap: -0.05,
		tagOverlapMax: -0.20, // Max boost for multiple tag overlaps
	},
	penalties: {
		titleLengthThreshold: 15,
		titleLengthMultiplier: 0.02,
		aliasMinPenalty: 0.05,
		aliasMaxPenalty: 0.60,
		aliasLengthMultiplier: 0.04,
		positionMultiplier: 0.05,
	},
	thresholds: {
		recencyDays: 1, // Files opened within this many days get recency boost
		fuzzyRelaxCount: 5, // Relax fuzzy threshold if fewer than this many results
	}
} as const;

export type SearchWeightsConfig = typeof SearchWeights;

export class FileIndex {
	protected static instance: FileIndex;
	private app: App;
	private plugin: Plugin;
	private fileMap: Map<string, IndexedFile> = new Map();
	private fuseStrict: Fuse<IndexedFile>;
	private fuseRelaxed: Fuse<IndexedFile>;
	private recentFiles = new LRUCache<number>();
	private unresolvedLinks: Set<string> = new Set();
	private isIndexing = false;
	private indexPromise: Promise<void> | null = null;
	private reindexTimeout: ReturnType<typeof setTimeout> | null = null;
	private fuseUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
	private pendingFuseUpdates: Map<string, 'add' | 'update' | 'remove'> = new Map();
	private effectiveWeights: SearchWeightsConfig = SearchWeights;

	protected constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
		
		const fuseConfig = {
			keys: [
				{ name: 'basename', weight: 0.8 }, // Prioritize basename matches
				{ name: 'aliases', weight: 0.6 },  // Reduced from 1.0
				{ name: 'path', weight: 0.2 }
			],
			ignoreLocation: true,
			findAllMatches: true,
			shouldSort: false, // We'll handle sorting ourselves
			includeMatches: true, // Include match information to detect alias hits
			getFn: getFuseValue
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
			clearTimeout(this.reindexTimeout);
		}
		this.reindexTimeout = globalThis.setTimeout(() => {
			this.reindex();
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
				await new Promise(resolve => setTimeout(resolve, 0));
			}
		};

		await processInBatches(files);

		this.fileMap = newFileMap;
		this.updateFuseIndex();
		this.updateUnresolvedLinks();
	}

	private createIndexedFile(file: TFile): IndexedFile {
		const fileCache = this.app.metadataCache.getFileCache(file);
		const frontmatter = fileCache?.frontmatter;
		
		// Extract aliases
		const aliases: string[] = [];
		const aliasData = frontmatter?.alias ?? frontmatter?.aliases;
		if (typeof aliasData === 'string') {
			aliases.push(aliasData);
		} else if (Array.isArray(aliasData)) {
			aliases.push(...aliasData.filter(a => typeof a === 'string'));
		}

		// Extract and sanitize headings at index time
		const headings = (fileCache?.headings ?? []).map(h => sanitizeHeading(h.heading));

		// Extract block IDs
		const blockIds: string[] = [];
		if (fileCache?.blocks) {
			for (const block of Object.values(fileCache.blocks)) {
				if (block.id) {
					blockIds.push(block.id);
				}
			}
		}

		// Extract tags
		const tags = fileCache?.tags?.map(t => t.tag) ?? [];
		if (frontmatter?.tags) {
			const frontmatterTags = Array.isArray(frontmatter.tags) 
				? frontmatter.tags 
				: [frontmatter.tags];
			tags.push(...frontmatterTags.filter(t => typeof t === 'string'));
		}

		return {
			path: file.path,
			basename: file.basename,
			aliases,
			headings,
			blockIds,
			tags,
			modified: file.stat.mtime,
			openedAt: this.recentFiles.get(file.path),
			folder: file.parent?.path ?? ""
		};
	}

	private addFile(file: TFile): void {
		const indexedFile = this.createIndexedFile(file);
		this.fileMap.set(file.path, indexedFile);
		this.scheduleFuseUpdate(file.path, 'add');
	}

	private updateFile(file: TFile): void {
		// Incremental update for single file - more efficient than full reindex
		const indexedFile = this.createIndexedFile(file);
		this.fileMap.set(file.path, indexedFile);
		this.scheduleFuseUpdate(file.path, 'update');
		this.updateUnresolvedLinks();
	}

	private removeFile(file: TFile): void {
		this.removeFileByPath(file.path);
	}

	private removeFileByPath(path: string): void {
		this.fileMap.delete(path);
		this.scheduleFuseUpdate(path, 'remove');
	}

	private updateFuseIndex(): void {
		const files = Array.from(this.fileMap.values());
		this.fuseStrict.setCollection(files);
		this.fuseRelaxed.setCollection(files);
	}

	private scheduleFuseUpdate(path: string, operation: 'add' | 'update' | 'remove'): void {
		// If we're doing a full reindex, don't bother with incremental updates
		if (this.isIndexing) return;

		// Handle operation sequences to prevent duplicates
		const existingOp = this.pendingFuseUpdates.get(path);
		if (existingOp) {
			// State machine to handle operation sequences
			if (existingOp === 'add' && operation === 'remove') {
				// add + remove = no-op (file was created then deleted)
				this.pendingFuseUpdates.delete(path);
				return;
			} else if (existingOp === 'remove' && operation === 'add') {
				// remove + add = update (common in rename operations)
				this.pendingFuseUpdates.set(path, 'update');
			} else {
				// For other sequences, keep the latest operation
				this.pendingFuseUpdates.set(path, operation);
			}
		} else {
			this.pendingFuseUpdates.set(path, operation);
		}

		// Clear existing timeout
		if (this.fuseUpdateTimeout !== null) {
			clearTimeout(this.fuseUpdateTimeout);
		}

		// Debounce updates - use globalThis for cross-platform compatibility
		this.fuseUpdateTimeout = globalThis.setTimeout(() => {
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

		// Process each pending update
		for (const [path, operation] of this.pendingFuseUpdates) {
			switch (operation) {
				case 'add': {
					// Always remove first to prevent duplicates
					this.fuseStrict.remove((doc) => doc.path === path);
					this.fuseRelaxed.remove((doc) => doc.path === path);
					
					const file = this.fileMap.get(path);
					if (file) {
						this.fuseStrict.add(file);
						this.fuseRelaxed.add(file);
					}
					break;
				}
				case 'update': {
					// For updates, we need to remove the old version first
					// Fuse doesn't have a direct update method
					this.fuseStrict.remove((doc) => doc.path === path);
					this.fuseRelaxed.remove((doc) => doc.path === path);
					
					const file = this.fileMap.get(path);
					if (file) {
						this.fuseStrict.add(file);
						this.fuseRelaxed.add(file);
					}
					break;
				}
				case 'remove': {
					this.fuseStrict.remove((doc) => doc.path === path);
					this.fuseRelaxed.remove((doc) => doc.path === path);
					break;
				}
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
	}

	search(query: string, context: SearchContext = {}, limit = 50): SearchResult[] {
		const results: SearchResult[] = [];
		const queryLower = normalizeForSearch(query);
		const fuseQuery = normalizeForFuse(query);

		// Handle global heading search when query contains '#'
		if (query.includes('#')) {
			return this.searchWithHeadings(query, context, limit);
		}

		// Track which files we've already added to avoid duplicates
		const addedPaths = new Set<string>();
		
		// Pre-create array from fileMap for better performance
		const allFiles = Array.from(this.fileMap.values());

		// 1. Exact matches (basename and aliases) - Tier 0
		for (const file of allFiles) {
			if (normalizeForSearch(file.basename) === queryLower) {
				results.push({
					file,
					score: this.calculateScore(file, query, context, this.effectiveWeights.base.basenameExact, 'exact'),
					matchType: 'exact',
					displayText: file.basename
				});
				addedPaths.add(file.path);
			}

		}
		
		// Exact alias matches (separate loop to ensure basename-exact always wins)
		for (const file of allFiles) {
			if (addedPaths.has(file.path)) continue;
			
			for (const alias of file.aliases) {
				if (normalizeForSearch(alias) === queryLower) {
					results.push({
						file,
						score: this.calculateScore(file, query, context, this.effectiveWeights.base.aliasExact, 'alias'),
						matchType: 'alias',
						displayText: alias
					});
					addedPaths.add(file.path);
					break;
				}
			}
		}

		// 1.5. Prefix matches (basename) - Tier 1
		for (const file of allFiles) {
			const basenameLower = normalizeForSearch(file.basename);
			if (basenameLower.startsWith(queryLower) && 
				basenameLower !== queryLower && // not exact (already added)
				!addedPaths.has(file.path)) {
				results.push({
					file,
					score: this.calculateScore(file, query, context, this.effectiveWeights.base.basenamePrefix, 'fuzzy'),
					matchType: 'fuzzy',
					displayText: file.basename
				});
				addedPaths.add(file.path);
			}
		}

		// 2. Prefix alias matches - Tier 1
		for (const file of allFiles) {
			for (const alias of file.aliases) {
				const aliasLower = normalizeForSearch(alias);
				if (aliasLower.startsWith(queryLower) && 
					aliasLower !== queryLower &&  // not exact (already added)
					!addedPaths.has(file.path)) {
					results.push({
						file,
						score: this.calculateScore(file, query, context, this.effectiveWeights.base.aliasPrefix, 'alias'),
						matchType: 'alias',
						displayText: alias
					});
					addedPaths.add(file.path);
				}
			}
		}

		// 2.5. Substring-basename matches (word boundary) - Tier 2
		for (const file of allFiles) {
			if (addedPaths.has(file.path)) continue;
			
			const basenameLower = normalizeForSearch(file.basename);
			const idx = basenameLower.indexOf(queryLower);
			if (idx > 0) { // not at start (that would be prefix)
				// Check if match starts at word boundary
				const charBefore = basenameLower[idx - 1];
				if (!ALPHANUMERIC_REGEX.test(charBefore)) { // Previous char is not alphanumeric
					results.push({
						file,
						score: this.calculateScore(file, query, context, this.effectiveWeights.base.substringBasename, 'fuzzy'),
						matchType: 'fuzzy',
						displayText: file.basename
					});
					addedPaths.add(file.path);
				}
			}
		}

		// 3. Fuzzy search with adaptive threshold - Tier 3 and below
		let fuseResults = this.fuseStrict.search(fuseQuery, { limit: limit * 2 });

		// Relax threshold if we have too few results
		if (fuseResults.length < this.effectiveWeights.thresholds.fuzzyRelaxCount) {
			fuseResults = this.fuseRelaxed.search(fuseQuery, { limit: limit * 2 });
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
			const fromAlias = (result.matches ?? []).some(m => m.key === 'aliases');
			const matchType = fromAlias ? 'alias' : 'fuzzy';
			const displayText = fromAlias 
				? (result.matches?.find(m => m.key === 'aliases')?.value as string) ?? result.item.basename
				: result.item.basename;

			results.push({
				file: result.item,
				score: this.calculateScore(result.item, query, context, (result.score ?? 0.5) + this.effectiveWeights.base.fuzzyMatch, matchType),
				matchType,
				displayText
			});
			addedPaths.add(result.item.path);
		}

		// 4. Unresolved links - Tier 3
		if (query.length >= 2) {
			let unresolvedCount = 0;
			const unresolvedLimit = query.length < 3 ? 10 : 20;
			
			for (const unresolvedLink of this.unresolvedLinks) {
				if (unresolvedCount >= unresolvedLimit) break;
				
				if (normalizeForSearch(unresolvedLink).includes(queryLower)) {
					results.push({
						file: {
							path: unresolvedLink,
							basename: unresolvedLink,
							aliases: [],
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
		let score = baseScore;

		// Same folder boost
		if (context.currentFolder && file.folder === context.currentFolder) {
			score += this.effectiveWeights.boosts.sameFolder;
		}

		// Recent files boost - check openedAt directly from file index
		if (file.openedAt) {
			const recency = (Date.now() - file.openedAt) / (1000 * 60 * 60 * 24); // days
			if (recency < this.effectiveWeights.thresholds.recencyDays) score += this.effectiveWeights.boosts.recency;
		}


		// Tag overlap boost
		if (context.currentFile) {
			const currentFileIndexed = this.fileMap.get(context.currentFile.path);
			if (currentFileIndexed) {
				const commonTags = file.tags.filter(tag => 
					currentFileIndexed.tags.includes(tag));
				if (commonTags.length > 0) {
					score += this.effectiveWeights.boosts.tagOverlap * Math.min(commonTags.length, Math.abs(this.effectiveWeights.boosts.tagOverlapMax / this.effectiveWeights.boosts.tagOverlap));
				}
			}
		}

		// Length penalty - calculate first as it's used by alias penalty
		const queryLower = normalizeForSearch(query);
		let titleLength = file.basename.length;
		
		// For alias matches, find the actual matched alias to get correct length
		if (matchType === 'alias' && file.aliases.length > 0) {
			// Find which alias was matched
			const matchedAlias = file.aliases.find(alias => 
				normalizeForSearch(alias).includes(queryLower)
			);
			if (matchedAlias) {
				titleLength = matchedAlias.length;
			}
		}
		
		// Alias penalty - scale based on length to allow good short aliases to compete
		if (matchType === 'alias') {
			// Length-scaled penalty: minimum 0.05 for short aliases, up to +0.60 for very long aliases
			// This ensures basename matches still have an edge even for short aliases
			const lengthPenalty = Math.max(0, (titleLength - this.effectiveWeights.penalties.titleLengthThreshold) * this.effectiveWeights.penalties.aliasLengthMultiplier);
			const aliasPenalty = Math.min(this.effectiveWeights.penalties.aliasMaxPenalty, this.effectiveWeights.penalties.aliasMinPenalty + lengthPenalty);
			score += aliasPenalty;
		}
		
		// Additional length penalty for all matches
		if (titleLength > this.effectiveWeights.penalties.titleLengthThreshold) {
			score += (titleLength - this.effectiveWeights.penalties.titleLengthThreshold) * this.effectiveWeights.penalties.titleLengthMultiplier;
		}

		// Position bonus - earlier matches are better
		let textToSearch = normalizeForSearch(file.basename);
		
		// For alias matches, find the actual matched alias for position calculation
		if (matchType === 'alias' && file.aliases.length > 0) {
			const matchedAlias = file.aliases.find(alias => 
				normalizeForSearch(alias).includes(queryLower)
			);
			if (matchedAlias) {
				textToSearch = normalizeForSearch(matchedAlias);
			}
		}
		
		const pos = textToSearch.indexOf(queryLower);
		if (pos >= 0) {
			score += pos * this.effectiveWeights.penalties.positionMultiplier; // Later position = higher score = worse ranking
		}

		// Don't flatten negative scores - preserve ranking differences
		return score;
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
		// Direct file search without heading handling to avoid recursion
		const results: SearchResult[] = [];
		const queryLower = normalizeForSearch(query);
		const fuseQuery = normalizeForFuse(query);
		const addedPaths = new Set<string>();
		
		// Pre-create array from fileMap for better performance
		const allFiles = Array.from(this.fileMap.values());

		// 1. Exact matches (basename and aliases) - Tier 0
		for (const file of allFiles) {
			if (normalizeForSearch(file.basename) === queryLower) {
				results.push({
					file,
					score: this.calculateScore(file, query, context, -1000, 'exact'),
					matchType: 'exact',
					displayText: file.basename
				});
				addedPaths.add(file.path);
			}

		}
		
		// Exact alias matches (separate loop to ensure basename-exact always wins)
		for (const file of allFiles) {
			if (addedPaths.has(file.path)) continue;
			
			for (const alias of file.aliases) {
				if (normalizeForSearch(alias) === queryLower) {
					results.push({
						file,
						score: this.calculateScore(file, query, context, this.effectiveWeights.base.aliasExact, 'alias'),
						matchType: 'alias',
						displayText: alias
					});
					addedPaths.add(file.path);
					break;
				}
			}
		}

		// 1.5. Prefix matches (basename) - Tier 1
		for (const file of allFiles) {
			const basenameLower = normalizeForSearch(file.basename);
			if (basenameLower.startsWith(queryLower) && 
				basenameLower !== queryLower &&
				!addedPaths.has(file.path)) {
				results.push({
					file,
					score: this.calculateScore(file, query, context, -500, 'fuzzy'),
					matchType: 'fuzzy',
					displayText: file.basename
				});
				addedPaths.add(file.path);
			}
		}

		// 2. Prefix alias matches - Tier 1
		for (const file of allFiles) {
			for (const alias of file.aliases) {
				const aliasLower = normalizeForSearch(alias);
				if (aliasLower.startsWith(queryLower) && 
					aliasLower !== queryLower &&
					!addedPaths.has(file.path)) {
					results.push({
						file,
						score: this.calculateScore(file, query, context, -500, 'alias'),
						matchType: 'alias',
						displayText: alias
					});
					addedPaths.add(file.path);
				}
			}
		}

		// 2.5. Substring-basename matches (word boundary) - Tier 2
		for (const file of allFiles) {
			if (addedPaths.has(file.path)) continue;
			
			const basenameLower = normalizeForSearch(file.basename);
			const idx = basenameLower.indexOf(queryLower);
			if (idx > 0) { // not at start (that would be prefix)
				// Check if match starts at word boundary
				const charBefore = basenameLower[idx - 1];
				if (!ALPHANUMERIC_REGEX.test(charBefore)) { // Previous char is not alphanumeric
					results.push({
						file,
						score: this.calculateScore(file, query, context, -300, 'fuzzy'),
						matchType: 'fuzzy',
						displayText: file.basename
					});
					addedPaths.add(file.path);
				}
			}
		}

		// 3. Fuzzy search - Tier 3 and below
		let fuseResults = this.fuseStrict.search(fuseQuery, { limit: limit * 2 });
		if (fuseResults.length < this.effectiveWeights.thresholds.fuzzyRelaxCount) {
			fuseResults = this.fuseRelaxed.search(fuseQuery, { limit: limit * 2 });
		}

		for (const result of fuseResults) {
			// Defensive: skip malformed Fuse results
			if (!result || !result.item || !result.item.path) {
				continue;
			}

			if (addedPaths.has(result.item.path)) {
				continue;
			}

			const fromAlias = (result.matches ?? []).some(m => m.key === 'aliases');
			const matchType = fromAlias ? 'alias' : 'fuzzy';
			const displayText = fromAlias 
				? (result.matches?.find(m => m.key === 'aliases')?.value as string) ?? result.item.basename
				: result.item.basename;

			results.push({
				file: result.item,
				score: this.calculateScore(result.item, query, context, (result.score ?? 0.5) + this.effectiveWeights.base.fuzzyMatch, matchType),
				matchType,
				displayText
			});
			addedPaths.add(result.item.path);
		}

		return results
			.sort((a, b) => a.score - b.score)
			.slice(0, limit);
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
