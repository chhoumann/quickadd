import type { App } from "obsidian";
import { TFile } from "obsidian";
import Fuse from "fuse.js";
import type { IndexedFile, SearchResult } from "../gui/suggesters/FileIndex";
import { sanitizeHeading } from "../gui/suggesters/utils";

// Utility helper to yield back to the event-loop
function sleep(ms: number) {
	return new Promise<void>((res) => setTimeout(res, ms));
}

const MAX_CACHE_ENTRIES = 100;

export class OptimizedFileIndex {
	private static _instance: OptimizedFileIndex | null = null;
	private index: Map<string, IndexedFile> = new Map();
	private fuseInstance: Fuse<IndexedFile>;
	private pendingUpdates: Map<string, "add" | "update" | "delete"> = new Map();
	private updateTimer: number | null = null;
	private worker: Worker | null = null;

	// 5-second query result cache
	private searchCache = new Map<string, SearchResult[]>();
	private cacheTimeout: number | null = null;

	private initialIndexPromise: Promise<void> | null = null;

	constructor(private app: App) {
		// Initialise worker if the environment supports it
		if (typeof Worker !== "undefined") {
			try {
				// esbuild rewrites the URL when using new URL()
				this.worker = new Worker(
					new URL("../workers/file-indexer-worker.js", import.meta.url),
					{ type: "module" }
				);
				this.worker.onmessage = this.handleWorkerMessage.bind(this);
				this.worker.addEventListener("error", (ev) => {
					console.error("OptimizedFileIndex worker error", ev);
					// Disable worker fallback
					this.worker?.terminate();
					this.worker = null;
				});
			} catch (err) {
				console.warn("OptimizedFileIndex: failed to create worker", err);
				this.worker = null;
			}
		}

		// Fuse configuration
		this.fuseInstance = new Fuse([], {
			keys: [
				{ name: "basename" as keyof IndexedFile, weight: 0.8 },
				{ name: "aliases" as keyof IndexedFile, weight: 0.6 },
				{ name: "path" as keyof IndexedFile, weight: 0.2 },
			],
			ignoreLocation: true,
			findAllMatches: true,
			shouldSort: true,
		});

		// Kick off initial async index build
		this.initialIndexPromise = this.initializeIndex();
	}

	/* ------------------------------ Indexing ------------------------------ */

	private async initializeIndex() {
		const files = this.app.vault.getMarkdownFiles();
		const chunkSize = 100;

		for (let i = 0; i < files.length; i += chunkSize) {
			const chunk = files.slice(i, i + chunkSize);
			await this.indexChunk(chunk);
			await sleep(0); // Yield to UI thread
		}

		this.buildFuseIndex();
	}

	/** Index a chunk of files on the main thread */
	private async indexChunk(chunk: TFile[]) {
		for (const file of chunk) {
			const indexed = await this.indexFile(file);
			this.index.set(file.path, indexed);
		}
	}

	/** Build a single IndexedFile representation */
	private async indexFile(file: TFile): Promise<IndexedFile> {
		let fileCache: any;
		try {
			fileCache = this.app.metadataCache.getFileCache(file);
		} catch (err) {
			console.error("OptimizedFileIndex: Failed to read metadata cache for", file.path, err);
			fileCache = {};
		}
		const frontmatter = fileCache?.frontmatter ?? {};

		// Aliases
		const aliases: string[] = [];
		const aliasData = frontmatter?.alias ?? frontmatter?.aliases;
		if (typeof aliasData === "string") {
			aliases.push(aliasData);
		} else if (Array.isArray(aliasData)) {
			aliases.push(...aliasData.filter((a) => typeof a === "string"));
		}

		// Headings
		const headings = (fileCache?.headings ?? []).map((h: { heading: string }) => sanitizeHeading(h.heading));

		// Block IDs
		const blockIds: string[] = [];
		if (fileCache?.blocks) {
			for (const block of Object.values(fileCache.blocks as Record<string, { id?: string }>)) {
				if (block.id) blockIds.push(block.id);
			}
		}

		// Tags
		const tags = fileCache?.tags?.map((t) => t.tag) ?? [];
		if (frontmatter?.tags) {
			const fmTags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [frontmatter.tags];
			tags.push(...fmTags.filter((t: unknown): t is string => typeof t === "string"));
		}

		return {
			path: file.path,
			basename: file.basename,
			aliases,
			headings,
			blockIds,
			tags,
			modified: file.stat.mtime,
			folder: file.parent?.path ?? "",
		};
	}

	private buildFuseIndex() {
		this.fuseInstance.setCollection(Array.from(this.index.values()));
	}

	private rebuildFuseIndexIncremental(updates: Array<[string, string]>) {
		if (!this.fuseInstance) {
			this.buildFuseIndex();
			return;
		}

		for (const [path, operation] of updates) {
			if (operation === "delete") {
				this.fuseInstance.remove((item: IndexedFile) => item.path === path);
			} else {
				const item = this.index.get(path);
				if (!item) continue;
				if (operation === "update") {
					this.fuseInstance.remove((doc: IndexedFile) => doc.path === path);
				}
				this.fuseInstance.add(item);
			}
		}
	}

	/** Serialise current index into transferable form */
	private serializeIndex(): Array<[string, IndexedFile]> {
		return Array.from(this.index.entries());
	}

	/* -------------------------- Incremental update ------------------------- */

	async updateFile(file: TFile, operation: "add" | "update" | "delete") {
		this.pendingUpdates.set(file.path, operation);
		this.scheduleIndexUpdate();
	}

	private scheduleIndexUpdate() {
		if (this.updateTimer) {
			clearTimeout(this.updateTimer);
		}

		this.updateTimer = window.setTimeout(() => {
			void this.processPendingUpdates();
		}, 500);
	}

	private async processPendingUpdates() {
		if (this.pendingUpdates.size === 0) return;

		const updates = Array.from(this.pendingUpdates.entries());
		this.pendingUpdates.clear();

		if (this.worker) {
			// Off-load heavy lifting
			this.worker.postMessage({
				type: "updateIndex",
				updates,
				currentIndex: this.serializeIndex(),
			});
		} else {
			await this.processUpdatesMainThread(updates);
		}
	}

	private async processUpdatesMainThread(updates: Array<[string, string]>) {
		for (const [path, operation] of updates) {
			if (operation === "delete") {
				this.index.delete(path);
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(path) as TFile | null;
			if (file) {
				const indexed = await this.indexFile(file);
				this.index.set(path, indexed);
			}
		}

		this.rebuildFuseIndexIncremental(updates);
	}

	/* ------------------------------ Searching ------------------------------ */

	search(query: string): SearchResult[] {
		if (this.searchCache.has(query)) {
			return this.searchCache.get(query)!;
		}

		const results = this.fuseInstance.search(query) as unknown as SearchResult[];

		this.searchCache.set(query, results);

		// Limit cache size to avoid memory pressure
		if (this.searchCache.size > MAX_CACHE_ENTRIES) {
			// Remove oldest entry (first inserted)
			const firstKey = this.searchCache.keys().next().value as string;
			this.searchCache.delete(firstKey);
		}

		if (this.cacheTimeout) {
			clearTimeout(this.cacheTimeout);
		}
		this.cacheTimeout = window.setTimeout(() => {
			this.searchCache.clear();
		}, 5000);

		return results;
	}

	/* ----------------------------- Worker IPC ----------------------------- */

	private handleWorkerMessage(e: MessageEvent) {
		const { type } = e.data;
		if (type === "indexUpdated") {
			const serialized: Array<[string, IndexedFile]> = e.data.index;
			this.index = new Map(serialized);
			this.buildFuseIndex();
		} else if (type === "indexFailed" || type === "searchFailed") {
			console.error("OptimizedFileIndex: worker error", e.data.error);
			// Disable worker to prevent repeated failures
			this.worker?.terminate();
			this.worker = null;
		}
	}

	/** Public helper to wait until the initial index build is complete. */
	async ensureIndexed() {
		if (this.initialIndexPromise) {
			await this.initialIndexPromise;
		}
	}

	getFile(path: string): IndexedFile | undefined {
		return this.index.get(path);
	}

	getHeadings(file: IndexedFile): string[] {
		return file.headings;
	}

	getBlockIds(file: IndexedFile): string[] {
		return file.blockIds;
	}

	getIndexedFileCount(): number {
		return this.index.size;
	}

	static getInstance(app: App): OptimizedFileIndex {
		if (!OptimizedFileIndex._instance) {
			OptimizedFileIndex._instance = new OptimizedFileIndex(app);
		}
		return OptimizedFileIndex._instance;
	}
}