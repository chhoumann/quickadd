import { describe, it, expect, beforeEach, vi } from "vitest";
import { FieldSuggestionCache } from "./FieldSuggestionCache";

describe("FieldSuggestionCache", () => {
	let cache: FieldSuggestionCache;

	beforeEach(() => {
		// Get a fresh instance and clear it
		cache = FieldSuggestionCache.getInstance();
		cache.clear();
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

		it("clears only the exact field, not a colon-prefixed sibling field", () => {
			cache.set("foo", new Set(["a"]), "folder");
			cache.set("foo:bar", new Set(["b"]));

			cache.clear("foo");

			// The distinct field "foo:bar" must survive clearing "foo".
			expect(cache.get("foo", "folder")).toBeNull();
			expect(cache.get("foo:bar")).toEqual(new Set(["b"]));
		});
	});

	describe("key collisions", () => {
		it("keeps (fieldName, cacheKey) pairs distinct when a field name contains a colon", () => {
			const valuesA = new Set(["a"]);
			const valuesB = new Set(["b"]);

			// With a raw ':' join these two pairs both map to "foo:bar:baz".
			cache.set("foo", valuesA, "bar:baz");
			cache.set("foo:bar", valuesB, "baz");

			expect(cache.get("foo", "bar:baz")).toEqual(valuesA);
			expect(cache.get("foo:bar", "baz")).toEqual(valuesB);
		});
	});

	describe("automatic cleanup", () => {
		beforeEach(() => {
			// Clear any existing state
			cache.destroy();
			cache = FieldSuggestionCache.getInstance();
			
			// Mock window.setInterval for tests
			global.window = {
				setInterval: vi.fn().mockReturnValue(456)
			} as any;
		});

		it("should start automatic cleanup with registered interval", () => {
			const mockRegisterInterval = vi.fn().mockReturnValue(123);
			
			cache.startAutomaticCleanup(mockRegisterInterval);
			
			expect(mockRegisterInterval).toHaveBeenCalledWith(456);
			expect(global.window.setInterval).toHaveBeenCalledWith(expect.any(Function), 60000);
		});

		it("should not start multiple intervals", () => {
			const mockRegisterInterval = vi.fn().mockReturnValue(123);
			
			cache.startAutomaticCleanup(mockRegisterInterval);
			cache.startAutomaticCleanup(mockRegisterInterval);
			
			expect(mockRegisterInterval).toHaveBeenCalledTimes(1);
		});

		it("should provide cache statistics", () => {
			cache.set("field1", new Set(["value1"]));
			
			const stats = cache.getStats();
			
			expect(stats).toEqual({
				size: 1,
				maxSize: 100,
				cleanupInterval: null // No interval started in test
			});
		});
	});
});
