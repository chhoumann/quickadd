import { describe, it, expect } from "vitest";
import { describePerf } from "../../tests/perfUtils";
import { FieldValueDeduplicator } from "./FieldValueDeduplicator";

describe("FieldValueDeduplicator", () => {
	describe("case-insensitive deduplication", () => {
		it("should deduplicate basic case variations", () => {
			const values = ["Active", "active", "ACTIVE", "Done", "DONE"];
			const result = FieldValueDeduplicator.deduplicate(values);

			expect(result.values).toEqual(["Active", "Done"]);
			expect(result.duplicatesRemoved).toBe(3);
		});

		it("should preserve first occurrence by default", () => {
			const values = ["todo", "TODO", "Todo", "DONE", "done"];
			const result = FieldValueDeduplicator.deduplicate(values);

			expect(result.values).toEqual(["DONE", "todo"]);
		});

		it("should handle unicode normalization", () => {
			const values = ["café", "cafe", "CAFÉ", "naïve", "naive"];
			const result = FieldValueDeduplicator.deduplicate(values);

			expect(result.values).toEqual(["café", "naïve"]);
			expect(result.duplicatesRemoved).toBe(3);
		});

		it("should handle empty strings and whitespace", () => {
			const values = ["", " ", "test", "TEST", "   ", "test "];
			const result = FieldValueDeduplicator.deduplicate(values);

			// Each whitespace variation should be considered different
			expect(new Set(result.values)).toEqual(new Set(["", " ", "test", "   ", "test "]));
		});

		it("should handle special characters and symbols", () => {
			const values = ["@user", "@USER", "#tag", "#TAG", "user@domain", "USER@DOMAIN"];
			const result = FieldValueDeduplicator.deduplicate(values);

			expect(result.values).toHaveLength(3);
			expect(result.duplicatesRemoved).toBe(3);
		});

		it("should handle emoji and unicode characters", () => {
			const values = ["🚀 Active", "🚀 ACTIVE", "✅ Done", "✅ done", "📝 Note"];
			const result = FieldValueDeduplicator.deduplicate(values);

			expect(result.values).toHaveLength(3);
			expect(result.duplicatesRemoved).toBe(2);
		});

		it("should preserve formatting differences (camelCase vs kebab-case)", () => {
			const values = ["InProgress", "in-progress", "in_progress"];
			const result = FieldValueDeduplicator.deduplicate(values);

			// These should be considered different since they use different formatting conventions
			expect(result.values).toHaveLength(3);
			expect(result.duplicatesRemoved).toBe(0);
		});
	});

	describe("case-sensitive deduplication", () => {
		it("should preserve case differences", () => {
			const values = ["Active", "active", "ACTIVE", "Done"];
			const result = FieldValueDeduplicator.deduplicate(values, true);

			expect(result.values).toHaveLength(4);
			expect(result.duplicatesRemoved).toBe(0);
		});

		it("should remove exact duplicates only", () => {
			const values = ["test", "test", "Test", "TEST"];
			const result = FieldValueDeduplicator.deduplicate(values, true);

			expect(result.values).toHaveLength(3);
			expect(result.duplicatesRemoved).toBe(1);
		});
	});

	describe("sorting behavior", () => {
		it("should sort case-insensitively while preserving original case", () => {
			const values = ["zebra", "Apple", "banana", "ZEBRA"];
			const result = FieldValueDeduplicator.deduplicate(values);

			// Should be sorted: Apple, banana, zebra (case-insensitive order)
			expect(result.values[0].toLowerCase()).toBe("apple");
			expect(result.values[1].toLowerCase()).toBe("banana");
			expect(result.values[2].toLowerCase()).toBe("zebra");
		});

	});

	describePerf("performance with large datasets", () => {
		it("should handle 1000+ values efficiently", () => {
			const values: string[] = [];
			for (let i = 0; i < 1000; i++) {
				values.push(`value${i % 100}`); // 100 unique values with 10 copies each
				values.push(`VALUE${i % 100}`); // Case variations
			}

			const startTime = performance.now();
			const result = FieldValueDeduplicator.deduplicate(values);
			const endTime = performance.now();

			expect(result.values).toHaveLength(100);
			expect(result.duplicatesRemoved).toBe(1900);
			expect(endTime - startTime).toBeLessThan(100); // Should complete in < 100ms
		});

		it("should handle 10000+ values within reasonable time", () => {
			const values: string[] = [];
			for (let i = 0; i < 10000; i++) {
				values.push(`item${i % 1000}`); // 1000 unique values with 10 copies each
			}

			const startTime = performance.now();
			const result = FieldValueDeduplicator.deduplicate(values);
			const endTime = performance.now();

			expect(result.values).toHaveLength(1000);
			expect(endTime - startTime).toBeLessThan(500); // Should complete in < 500ms
		});
	});

	describe("edge cases", () => {
		it("should handle empty input array", () => {
			const result = FieldValueDeduplicator.deduplicate([]);
			
			expect(result.values).toEqual([]);
			expect(result.duplicatesRemoved).toBe(0);
		});

		it("should handle single value", () => {
			const result = FieldValueDeduplicator.deduplicate(["single"]);
			
			expect(result.values).toEqual(["single"]);
			expect(result.duplicatesRemoved).toBe(0);
		});

		it("should handle arrays with only duplicates", () => {
			const values = ["same", "SAME", "Same"];
			const result = FieldValueDeduplicator.deduplicate(values);

			expect(result.values).toHaveLength(1);
			expect(result.duplicatesRemoved).toBe(2);
		});

		it("should handle very long strings", () => {
			const longString = "a".repeat(1000);
			const values = [longString, longString.toUpperCase(), "short"];
			const result = FieldValueDeduplicator.deduplicate(values);

			expect(result.values).toHaveLength(2);
			expect(result.duplicatesRemoved).toBe(1);
		});

		it("should handle strings with newlines and special whitespace", () => {
			const values = ["line1\nline2", "LINE1\nLINE2", "tab\there", "TAB\tHERE"];
			const result = FieldValueDeduplicator.deduplicate(values);

			expect(result.values).toHaveLength(2);
			expect(result.duplicatesRemoved).toBe(2);
		});
	});

});
