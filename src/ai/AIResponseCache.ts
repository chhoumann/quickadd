import type { CommonResponse } from "./OpenAIRequest";

/**
 * Simple Least-Recently-Used (LRU) cache implementation.
 * This is intentionally minimal – only the operations we need
 * for response caching are implemented (get & set).
 */
class LRUCache<T> {
	private cache = new Map<string, T>();
	constructor(private readonly maxSize = 100) {}

	get(key: string): T | undefined {
		const value = this.cache.get(key);
		if (value !== undefined) {
			// Refresh the key – move to the end so it is marked as recently used
			this.cache.delete(key);
			this.cache.set(key, value);
		}
		return value;
	}

	set(key: string, value: T): void {
		if (this.cache.has(key)) {
			this.cache.delete(key);
		} else if (this.cache.size >= this.maxSize) {
			// Remove the least-recently-used item (first item in Map)
			const firstKey = this.cache.keys().next().value;
			this.cache.delete(firstKey);
		}
		this.cache.set(key, value);
	}
}

/**
 * Singleton for caching AI responses. The cache size is capped to avoid
 * unbounded memory growth. A small cache goes a long way because prompts are
 * often repeated during the same session (e.g. while iterating on templates).
 */
export class AIResponseCache {
	private static _instance: AIResponseCache;
	private readonly cache = new LRUCache<CommonResponse>(100);

	private constructor() {}

	static get instance(): AIResponseCache {
		if (!this._instance) {
			this._instance = new AIResponseCache();
		}
		return this._instance;
	}

	get(key: string): CommonResponse | undefined {
		return this.cache.get(key);
	}

	set(key: string, value: CommonResponse): void {
		this.cache.set(key, value);
	}
}

/**
 * Utility to build a deterministic cache key from model and prompt data.
 * We include the system prompt because that can influence the outcome just
 * as much as the user prompt.
 */
export function buildCacheKey(modelName: string, systemPrompt: string, prompt: string): string {
	return `${modelName}::${systemPrompt}::${prompt}`;
}