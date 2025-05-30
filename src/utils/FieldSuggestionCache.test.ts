import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FieldSuggestionCache } from "./FieldSuggestionCache";

describe("FieldSuggestionCache", () => {
	let cache: FieldSuggestionCache;

	beforeEach(() => {
		// Get a fresh instance and clear it
		cache = FieldSuggestionCache.getInstance();
		cache.clear();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("singleton pattern", () => {
		it("should return the same instance", () => {
			const instance1 = FieldSuggestionCache.getInstance();
			const instance2 = FieldSuggestionCache.getInstance();
			expect(instance1).toBe(instance2);
		});
	});

	describe("basic operations", () => {
		it("should store and retrieve values", () => {
			const values = new Set(["value1", "value2", "value3"]);
			cache.set("fieldName", values);

			const retrieved = cache.get("fieldName");
			expect(retrieved).toEqual(values);
			expect(retrieved).not.toBe(values); // Should be a copy
		});

		it("should return null for non-existent keys", () => {
			const result = cache.get("nonexistent");
			expect(result).toBeNull();
		});

		it("should handle cache keys", () => {
			const values1 = new Set(["value1"]);
			const values2 = new Set(["value2"]);

			cache.set("field", values1);
			cache.set("field", values2, "folder:daily");

			expect(cache.get("field")).toEqual(values1);
			expect(cache.get("field", "folder:daily")).toEqual(values2);
		});
	});

	describe("TTL and expiration", () => {
		it("should return null for expired entries", () => {
			const values = new Set(["value1"]);
			cache.set("field", values);

			// Fast forward past TTL (5 minutes)
			vi.advanceTimersByTime(6 * 60 * 1000);

			const result = cache.get("field");
			expect(result).toBeNull();
		});

		it("should return values within TTL", () => {
			const values = new Set(["value1"]);
			cache.set("field", values);

			// Fast forward less than TTL
			vi.advanceTimersByTime(4 * 60 * 1000);

			const result = cache.get("field");
			expect(result).toEqual(values);
		});
	});

	describe("clear operations", () => {
		it("should clear specific field", () => {
			cache.set("field1", new Set(["value1"]));
			cache.set("field2", new Set(["value2"]));
			cache.set("field1", new Set(["value3"]), "folder:daily");

			cache.clear("field1");

			expect(cache.get("field1")).toBeNull();
			expect(cache.get("field1", "folder:daily")).toBeNull();
			expect(cache.get("field2")).toEqual(new Set(["value2"]));
		});

		it("should clear entire cache", () => {
			cache.set("field1", new Set(["value1"]));
			cache.set("field2", new Set(["value2"]));

			cache.clear();

			expect(cache.get("field1")).toBeNull();
			expect(cache.get("field2")).toBeNull();
		});
	});

	describe("cleanExpired", () => {
		it("should remove only expired entries", () => {
			cache.set("field1", new Set(["value1"]));

			// Fast forward 3 minutes
			vi.advanceTimersByTime(3 * 60 * 1000);
			cache.set("field2", new Set(["value2"]));

			// Fast forward another 3 minutes (field1 is now expired, field2 is not)
			vi.advanceTimersByTime(3 * 60 * 1000);

			cache.cleanExpired();

			expect(cache.get("field1")).toBeNull();
			expect(cache.get("field2")).toEqual(new Set(["value2"]));
		});
	});
});