import type { App, EventRef } from "obsidian";

interface CacheEntry {
	fieldName: string;
	values: Set<string>;
	timestamp: number;
}

export class FieldSuggestionCache {
	private static instance: FieldSuggestionCache;
	private cache: Map<string, CacheEntry> = new Map();
	private readonly TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
	private readonly MAX_CACHE_ENTRIES = 100; // Maximum number of cache entries
	private readonly MAX_VALUES_PER_ENTRY = 1000; // Maximum values per field
	private cleanupInterval: number | null = null;
	private revision = 0;

	static getInstance(): FieldSuggestionCache {
		if (!FieldSuggestionCache.instance) {
			FieldSuggestionCache.instance = new FieldSuggestionCache();
		}
		return FieldSuggestionCache.instance;
	}

	private constructor() {
		// Automatic cleanup will be started by the plugin using startAutomaticCleanup()
	}

	/**
	 * Start automatic cleanup - should be called by the plugin with registered interval
	 * @param registerInterval Function to register the interval with Obsidian
	 */
	startAutomaticCleanup(registerInterval: (id: number) => number): void {
		if (this.cleanupInterval === null && typeof window !== 'undefined') {
			const intervalId = window.setInterval(() => {
				this.cleanExpired();
			}, 60 * 1000);
			this.cleanupInterval = registerInterval(intervalId);
		}
	}

	/**
	 * Invalidate suggestions whenever Obsidian's indexed vault state changes.
	 * FIELD cache entries can depend on any Markdown file because folder, tag,
	 * exclusion, and inline-field filters all share this cache. Clearing the small
	 * bounded cache is both safer and cheaper than trying to reconstruct which
	 * field/filter combinations a changed file might affect.
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

	/**
	 * Get cached values for a field
	 * @param fieldName The field name
	 * @param cacheKey Additional key for filtering (e.g., folder path)
	 * @returns Cached values or null if expired/not found
	 */
	get(fieldName: string, cacheKey?: string): Set<string> | null {
		const key = this.makeKey(fieldName, cacheKey);
		const entry = this.cache.get(key);

		if (!entry) return null;

		// Check if cache is expired
		if (Date.now() - entry.timestamp > this.TTL) {
			this.cache.delete(key);
			return null;
		}

		return new Set(entry.values);
	}

	/**
	 * Set cached values for a field
	 * @param fieldName The field name
	 * @param values The values to cache
	 * @param cacheKey Additional key for filtering (e.g., folder path)
	 */
	set(fieldName: string, values: Set<string>, cacheKey?: string): void {
		const key = this.makeKey(fieldName, cacheKey);

		const limitedValues = new Set<string>();
		for (const value of values) {
			if (limitedValues.size >= this.MAX_VALUES_PER_ENTRY) break;
			limitedValues.add(value);
		}

		// Check if we need to evict old entries
		if (this.cache.size >= this.MAX_CACHE_ENTRIES && !this.cache.has(key)) {
			this.evictOldestEntries(1);
		}

		this.cache.set(key, {
			fieldName,
			values: limitedValues,
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

	/**
	 * Evict the oldest cache entries
	 * @param count Number of entries to evict
	 */
	private evictOldestEntries(count: number): void {
		const entries = Array.from(this.cache.entries())
			.sort(([, a], [, b]) => a.timestamp - b.timestamp)
			.slice(0, count);

		for (const [key] of entries) {
			this.cache.delete(key);
		}
	}

	/**
	 * Clear cache for a specific field or all cache
	 * @param fieldName Optional field name to clear specific cache
	 */
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

	/**
	 * Clear cache entries older than TTL
	 */
	cleanExpired(): void {
		const now = Date.now();
		for (const [key, entry] of this.cache) {
			if (now - entry.timestamp > this.TTL) this.cache.delete(key);
		}
	}

	/**
	 * Get cache statistics for monitoring
	 */
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

	/**
	 * Cleanup resources when shutting down
	 * Note: Obsidian will automatically clear registered intervals
	 */
	destroy(): void {
		this.cleanupInterval = null;
		this.clear();
	}

	private makeKey(fieldName: string, cacheKey?: string): string {
		// Encode both components unambiguously. A raw `${fieldName}:${cacheKey}`
		// join collides when a field name itself contains a colon, e.g.
		// makeKey("foo", "bar:baz") === makeKey("foo:bar", "baz"). JSON-encoding a
		// tuple keeps every (fieldName, cacheKey) pair distinct. Empty/undefined
		// cacheKey collapse to the same key (legacy behavior).
		return JSON.stringify([fieldName, cacheKey || null]);
	}

}
