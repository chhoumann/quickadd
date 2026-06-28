

interface CacheEntry {
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

		// Limit the number of values per entry
		const limitedValues = new Set<string>();
		let count = 0;
		for (const value of values) {
			if (count >= this.MAX_VALUES_PER_ENTRY) break;
			limitedValues.add(value);
			count++;
		}

		// Check if we need to evict old entries
		if (this.cache.size >= this.MAX_CACHE_ENTRIES && !this.cache.has(key)) {
			this.evictOldestEntries(1);
		}

		this.cache.set(key, {
			values: limitedValues,
			timestamp: Date.now(),
		});
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
		if (fieldName) {
			// Clear all entries for this field. Compare the decoded field-name
			// component rather than a raw `${fieldName}:` prefix, which would both
			// over-match (a different field literally named `${fieldName}:...`) and
			// mis-match once keys are JSON-encoded.
			const keysToDelete: string[] = [];
			for (const key of this.cache.keys()) {
				if (this.keyFieldName(key) === fieldName) {
					keysToDelete.push(key);
				}
			}
			for (const key of keysToDelete) {
				this.cache.delete(key);
			}
		} else {
			// Clear entire cache
			this.cache.clear();
		}
	}

	/**
	 * Clear cache entries older than TTL
	 */
	cleanExpired(): void {
		const now = Date.now();
		const keysToDelete: string[] = [];

		for (const [key, entry] of this.cache.entries()) {
			if (now - entry.timestamp > this.TTL) {
				keysToDelete.push(key);
			}
		}

		for (const key of keysToDelete) {
			this.cache.delete(key);
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
		this.cache.clear();
	}

	private makeKey(fieldName: string, cacheKey?: string): string {
		// Encode both components unambiguously. A raw `${fieldName}:${cacheKey}`
		// join collides when a field name itself contains a colon, e.g.
		// makeKey("foo", "bar:baz") === makeKey("foo:bar", "baz"). JSON-encoding a
		// tuple keeps every (fieldName, cacheKey) pair distinct. Empty/undefined
		// cacheKey collapse to the same key (legacy behavior).
		return JSON.stringify([fieldName, cacheKey || null]);
	}

	/** Decode the field-name component of a key produced by {@link makeKey}. */
	private keyFieldName(key: string): string | undefined {
		try {
			const parsed = JSON.parse(key) as unknown;
			if (Array.isArray(parsed) && typeof parsed[0] === "string") {
				return parsed[0];
			}
		} catch {
			// Keys are always produced by makeKey, so this is unreachable in
			// practice; fall through to undefined defensively.
		}
		return undefined;
	}
}
