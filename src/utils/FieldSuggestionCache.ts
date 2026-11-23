import type { App, EventRef } from "obsidian";

interface CacheEntry {
	fieldName: string;
	values: Set<string>;
	timestamp: number;
}

export class FieldSuggestionCache {
	private static instance: FieldSuggestionCache;
	private cache: Map<string, CacheEntry> = new Map();
	private readonly TTL = 5 * 60 * 1000;
	private readonly MAX_CACHE_ENTRIES = 100;
	private cleanupInterval: number | null = null;
	private revision = 0;

	static getInstance(): FieldSuggestionCache {
		if (!FieldSuggestionCache.instance) {
			FieldSuggestionCache.instance = new FieldSuggestionCache();
		}
		return FieldSuggestionCache.instance;
	}

	private constructor() {
	}

	startAutomaticCleanup(registerInterval: (id: number) => number): void {
		if (this.cleanupInterval === null && typeof window !== 'undefined') {
			const intervalId = window.setInterval(() => {
				this.cleanExpired();
			}, 60 * 1000);
			this.cleanupInterval = registerInterval(intervalId);
		}
	}

	/**
	 * Filters make any entry depend on any Markdown file, so every indexed vault
	 * change clears the small bounded cache.
	 */
	registerInvalidationListeners(
		app: App,
		registerEvent: (eventRef: EventRef) => unknown,
	): void {
		const clear = () => this.clear();

		registerEvent(app.metadataCache.on("changed", clear));
		registerEvent(app.metadataCache.on("deleted", clear));
		// MetadataCache deliberately does not emit "changed" for renames. A rename
		// can move a note into or out of a folder filter, or change an exclude-file
		// match, so the vault event is required even when file contents are unchanged.
		registerEvent(app.vault.on("rename", clear));
	}

	get(fieldName: string, cacheKey?: string): Set<string> | null {
		const key = this.makeKey(fieldName, cacheKey);
		const entry = this.cache.get(key);

		if (!entry) return null;

		if (Date.now() - entry.timestamp > this.TTL) {
			this.cache.delete(key);
			return null;
		}

		return new Set(entry.values);
	}

	set(fieldName: string, values: Set<string>, cacheKey?: string): void {
		const key = this.makeKey(fieldName, cacheKey);

		if (this.cache.size >= this.MAX_CACHE_ENTRIES && !this.cache.has(key)) {
			this.evictOldestEntries(1);
		}

		this.cache.set(key, {
			fieldName,
			values: new Set(values),
			timestamp: Date.now(),
		});
	}

	/**
	 * Snapshot used to keep an in-flight vault scan from repopulating the cache
	 * after a metadata event has invalidated it.
	 */
	getRevision(): number {
		return this.revision;
	}

	setIfRevision(
		fieldName: string,
		values: Set<string>,
		cacheKey: string | undefined,
		expectedRevision: number,
	): boolean {
		if (this.revision !== expectedRevision) return false;
		this.set(fieldName, values, cacheKey);
		return true;
	}

	private evictOldestEntries(count: number): void {
		const entries = Array.from(this.cache.entries())
			.sort(([, a], [, b]) => a.timestamp - b.timestamp)
			.slice(0, count);

		for (const [key] of entries) {
			this.cache.delete(key);
		}
	}

	clear(fieldName?: string): void {
		this.revision++;
		if (!fieldName) {
			this.cache.clear();
			return;
		}
		for (const [key, entry] of this.cache) {
			if (entry.fieldName === fieldName) this.cache.delete(key);
		}
	}

	cleanExpired(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache) {
			if (now - entry.timestamp > this.TTL) this.cache.delete(key);
		}
	}

	getStats(): {
		size: number;
		maxSize: number;
		cleanupInterval: number | null;
	} {
		return {
			size: this.cache.size,
			maxSize: this.MAX_CACHE_ENTRIES,
			cleanupInterval: this.cleanupInterval,
		};
	}

	destroy(): void {
		this.cleanupInterval = null;
		this.clear();
	}

	private makeKey(fieldName: string, cacheKey?: string): string {
		// JSON-encoded so a field name containing a colon cannot collide.
		return JSON.stringify([fieldName, cacheKey || null]);
	}

}
