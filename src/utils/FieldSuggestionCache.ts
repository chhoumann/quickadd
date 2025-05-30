import type { TFile } from "obsidian";

interface CacheEntry {
	values: Set<string>;
	timestamp: number;
}

export class FieldSuggestionCache {
	private static instance: FieldSuggestionCache;
	private cache: Map<string, CacheEntry> = new Map();
	private readonly TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

	static getInstance(): FieldSuggestionCache {
		if (!FieldSuggestionCache.instance) {
			FieldSuggestionCache.instance = new FieldSuggestionCache();
		}
		return FieldSuggestionCache.instance;
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
		this.cache.set(key, {
			values: new Set(values),
			timestamp: Date.now(),
		});
	}

	/**
	 * Clear cache for a specific field or all cache
	 * @param fieldName Optional field name to clear specific cache
	 */
	clear(fieldName?: string): void {
		if (fieldName) {
			// Clear all entries for this field
			const keysToDelete: string[] = [];
			for (const key of this.cache.keys()) {
				if (key.startsWith(fieldName + ":") || key === fieldName) {
					keysToDelete.push(key);
				}
			}
			keysToDelete.forEach((key) => this.cache.delete(key));
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

		keysToDelete.forEach((key) => this.cache.delete(key));
	}

	private makeKey(fieldName: string, cacheKey?: string): string {
		return cacheKey ? `${fieldName}:${cacheKey}` : fieldName;
	}
}