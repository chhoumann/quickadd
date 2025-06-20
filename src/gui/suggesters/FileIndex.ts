import type { App, HeadingCache, BlockCache } from "obsidian";
import { TFile } from "obsidian";
import Fuse from "fuse.js";
import { sanitizeHeading } from "./utils";

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

export class FileIndex {
	private static instance: FileIndex;
	private app: App;
	private fileMap: Map<string, IndexedFile> = new Map();
	private fuseStrict: Fuse<IndexedFile>;
	private fuseRelaxed: Fuse<IndexedFile>;
	private recentFiles = new LRUCache<number>();
	private unresolvedLinks: Set<string> = new Set();
	private isIndexing = false;
	private indexPromise: Promise<void> | null = null;

	private constructor(app: App) {
		this.app = app;
		
		const fuseConfig = {
			keys: [
				{ name: 'basename', weight: 0.6 },
				{ name: 'aliases', weight: 1.0 }, // Increased weight for aliases
				{ name: 'path', weight: 0.2 }
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
	}

	static getInstance(app: App): FileIndex {
		if (!FileIndex.instance) {
			FileIndex.instance = new FileIndex(app);
		}
		return FileIndex.instance;
	}

	private setupEventListeners(): void {
		// Track recently opened files
		this.app.workspace.on('file-open', (file) => {
			if (file) {
				this.recentFiles.set(file.path, Date.now());
				// Update openedAt in our index
				const indexedFile = this.fileMap.get(file.path);
				if (indexedFile) {
					indexedFile.openedAt = Date.now();
				}
			}
		});

		// Incremental metadata updates for better performance
		this.app.metadataCache.on('changed', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.updateFile(file);
			}
		});

		// Fallback for resolved event (less frequent, full reindex only if needed)
		this.app.metadataCache.on('resolved', () => {
			// Only schedule reindex if we don't have any files indexed yet
			if (this.fileMap.size === 0) {
				this.scheduleReindex();
			}
		});

		// Handle file system changes
		this.app.vault.on('create', (file) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.addFile(file);
			}
		});

		this.app.vault.on('delete', (file) => {
			if (file instanceof TFile) {
				this.removeFile(file);
			}
		});

		this.app.vault.on('rename', (file, oldPath) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.removeFileByPath(oldPath);
				this.addFile(file);
			}
		});
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
		clearTimeout((this as any).reindexTimeout);
		(this as any).reindexTimeout = setTimeout(() => {
			this.reindex();
		}, 500);
	}

	private async reindex(): Promise<void> {
		if (this.isIndexing) return this.indexPromise!;

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
		this.updateFuseIndex();
	}

	private updateFile(file: TFile): void {
		// Incremental update for single file - more efficient than full reindex
		const indexedFile = this.createIndexedFile(file);
		this.fileMap.set(file.path, indexedFile);
		this.updateFuseIndex();
		this.updateUnresolvedLinks();
	}

	private removeFile(file: TFile): void {
		this.removeFileByPath(file.path);
	}

	private removeFileByPath(path: string): void {
		this.fileMap.delete(path);
		this.updateFuseIndex();
	}

	private updateFuseIndex(): void {
		const files = Array.from(this.fileMap.values());
		this.fuseStrict.setCollection(files);
		this.fuseRelaxed.setCollection(files);
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
		const queryLower = query.toLowerCase();

		// Handle global heading search when query contains '#'
		if (query.includes('#')) {
			return this.searchWithHeadings(query, context, limit);
		}

		// 1. Exact matches (basename and aliases)
		for (const file of this.fileMap.values()) {
			if (file.basename.toLowerCase() === queryLower) {
				results.push({
					file,
					score: this.calculateScore(file, query, context, 0, 'exact'),
					matchType: 'exact',
					displayText: file.basename
				});
			}

			for (const alias of file.aliases) {
				if (alias.toLowerCase() === queryLower) {
					results.push({
						file,
						score: this.calculateScore(file, query, context, 0, 'alias'),
						matchType: 'alias',
						displayText: alias
					});
				}
			}
		}

		// 1.5. Prefix alias matches - promote these above fuzzy results
		for (const file of this.fileMap.values()) {
			for (const alias of file.aliases) {
				if (alias.toLowerCase().startsWith(queryLower) && 
					alias.toLowerCase() !== queryLower &&  // not exact (already added)
					!results.some(r => r.file.path === file.path && r.matchType === 'alias')) {
					results.push({
						file,
						score: this.calculateScore(file, query, context, 0.05, 'alias'),
						matchType: 'alias',
						displayText: alias
					});
				}
			}
		}

		// 2. Fuzzy search with adaptive threshold - use pre-built instances
		let fuseResults = this.fuseStrict.search(query, { limit: limit * 2 });

		// Relax threshold if we have too few results
		if (fuseResults.length < 5) {
			fuseResults = this.fuseRelaxed.search(query, { limit: limit * 2 });
		}

		for (const result of fuseResults) {
			// Skip if already added as exact match
			if (results.some(r => r.file.path === result.item.path)) {
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
				score: this.calculateScore(result.item, query, context, result.score ?? 0.5, matchType),
				matchType,
				displayText
			});
		}

		// 3. Heading search: global [[#Heading]] support
		if (query.includes('#')) {
			const [, headingQueryRaw] = query.split('#');
			const headingQuery = headingQueryRaw.toLowerCase();

			if (headingQuery.length > 0) {
				for (const file of this.fileMap.values()) {
					for (const heading of file.headings) {
						if (!heading.toLowerCase().includes(headingQuery)) continue;

						results.push({
							file,
							score: this.calculateScore(file, query, context, 0.2),
							matchType: 'heading',
							displayText: `${file.basename}#${heading}`
						});
					}
				}
			}
		}

		// 4. Unresolved links
		if (query.length >= 2) {
			let unresolvedCount = 0;
			const unresolvedLimit = query.length < 3 ? 10 : 20;
			
			for (const unresolvedLink of this.unresolvedLinks) {
				if (unresolvedCount >= unresolvedLimit) break;
				
				if (unresolvedLink.toLowerCase().includes(queryLower)) {
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
						score: 1,
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
			score -= 0.15;
		}

		// Recent files boost - check openedAt directly from file index
		if (file.openedAt) {
			const recency = (Date.now() - file.openedAt) / (1000 * 60 * 60 * 24); // days
			if (recency < 1) score -= 0.10;
		}

		// Alias exact match boost
		const queryLower = query.toLowerCase();
		if (file.aliases.some(alias => alias.toLowerCase() === queryLower)) {
			score -= 0.30;
		}

		// Tag overlap boost
		if (context.currentFile) {
			const currentFileIndexed = this.fileMap.get(context.currentFile.path);
			if (currentFileIndexed) {
				const commonTags = file.tags.filter(tag => 
					currentFileIndexed.tags.includes(tag));
				if (commonTags.length > 0) {
					score -= 0.05 * commonTags.length;
				}
			}
		}

		// Alias preference boost
		if (matchType === 'alias') {
			score -= 0.10;
		}

		// Don't flatten negative scores - preserve ranking differences
		return score;
	}

	private searchWithHeadings(query: string, context: SearchContext, limit: number): SearchResult[] {
		const [filePart, headingPartRaw] = query.split('#');
		const headingPart = headingPartRaw.toLowerCase();
		const results: SearchResult[] = [];

		// Prevent infinite recursion by doing a simple search if no file part
		if (filePart === '') {
			// Global heading search - search all files with performance limit
			let resultCount = 0;
			const maxResults = 200; // Performance guard for large vaults
			
			for (const file of this.fileMap.values()) {
				if (resultCount >= maxResults) break;
				
				for (const heading of file.headings) {
					if (resultCount >= maxResults) break;
					
					if (heading.toLowerCase().includes(headingPart)) {
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
			for (const fileResult of fileResults) {
				for (const heading of fileResult.file.headings) {
					if (heading.toLowerCase().includes(headingPart)) {
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
		const queryLower = query.toLowerCase();

		// 1. Exact matches (basename and aliases)
		for (const file of this.fileMap.values()) {
			if (file.basename.toLowerCase() === queryLower) {
				results.push({
					file,
					score: this.calculateScore(file, query, context, 0, 'exact'),
					matchType: 'exact',
					displayText: file.basename
				});
			}

			for (const alias of file.aliases) {
				if (alias.toLowerCase() === queryLower) {
					results.push({
						file,
						score: this.calculateScore(file, query, context, 0, 'alias'),
						matchType: 'alias',
						displayText: alias
					});
				}
			}
		}

		// 2. Prefix alias matches
		for (const file of this.fileMap.values()) {
			for (const alias of file.aliases) {
				if (alias.toLowerCase().startsWith(queryLower) && 
					alias.toLowerCase() !== queryLower &&
					!results.some(r => r.file.path === file.path && r.matchType === 'alias')) {
					results.push({
						file,
						score: this.calculateScore(file, query, context, 0.05, 'alias'),
						matchType: 'alias',
						displayText: alias
					});
				}
			}
		}

		// 3. Fuzzy search
		let fuseResults = this.fuseStrict.search(query, { limit: limit * 2 });
		if (fuseResults.length < 5) {
			fuseResults = this.fuseRelaxed.search(query, { limit: limit * 2 });
		}

		for (const result of fuseResults) {
			if (results.some(r => r.file.path === result.item.path)) {
				continue;
			}

			const fromAlias = (result.matches ?? []).some(m => m.key === 'aliases');
			const matchType = fromAlias ? 'alias' : 'fuzzy';
			const displayText = fromAlias 
				? (result.matches?.find(m => m.key === 'aliases')?.value as string) ?? result.item.basename
				: result.item.basename;

			results.push({
				file: result.item,
				score: this.calculateScore(result.item, query, context, result.score ?? 0.5, matchType),
				matchType,
				displayText
			});
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

}
