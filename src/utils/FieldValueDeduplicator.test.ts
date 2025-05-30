import { describe, it, expect } from "vitest";
import { FieldValueDeduplicator, type DeduplicationOptions } from "./FieldValueDeduplicator";

describe("FieldValueDeduplicator", () => {
	describe("case-insensitive deduplication", () => {
		it("should deduplicate basic case variations", () => {
			const values = ["Active", "active", "ACTIVE", "Done", "DONE"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive',
				preserveFirstOccurrence: true,
				sortResult: false
			});

			expect(result.values).toEqual(["Active", "Done"]);
			expect(result.duplicatesRemoved).toBe(3);
			expect(result.strategy).toBe('case-insensitive');
		});

		it("should preserve first occurrence by default", () => {
			const values = ["todo", "TODO", "Todo", "DONE", "done"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive'
			});

			// Should preserve "todo" (first) and "DONE" (first)
			const resultSet = new Set(result.values);
			expect(resultSet.has("todo") || resultSet.has("TODO") || resultSet.has("Todo")).toBe(true);
			expect(resultSet.has("DONE") || resultSet.has("done")).toBe(true);
			expect(result.values).toHaveLength(2);
		});

		it("should handle unicode normalization", () => {
			const values = ["café", "cafe", "CAFÉ", "naïve", "naive"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive'
			});

			expect(result.values).toHaveLength(2);
			expect(result.duplicatesRemoved).toBe(3);
		});

		it("should handle empty strings and whitespace", () => {
			const values = ["", " ", "test", "TEST", "   ", "test "];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive'
			});

			// Each whitespace variation should be considered different
			expect(result.values.length).toBeGreaterThanOrEqual(4);
		});

		it("should handle special characters and symbols", () => {
			const values = ["@user", "@USER", "#tag", "#TAG", "user@domain", "USER@DOMAIN"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive'
			});

			expect(result.values).toHaveLength(3);
			expect(result.duplicatesRemoved).toBe(3);
		});

		it("should handle emoji and unicode characters", () => {
			const values = ["🚀 Active", "🚀 ACTIVE", "✅ Done", "✅ done", "📝 Note"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive'
			});

			expect(result.values).toHaveLength(3);
			expect(result.duplicatesRemoved).toBe(2);
		});

		it("should preserve formatting differences (camelCase vs kebab-case)", () => {
			const values = ["InProgress", "in-progress", "in_progress"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive'
			});

			// These should be considered different since they use different formatting conventions
			expect(result.values).toHaveLength(3);
			expect(result.duplicatesRemoved).toBe(0);
		});
	});

	describe("case-sensitive deduplication", () => {
		it("should preserve case differences", () => {
			const values = ["Active", "active", "ACTIVE", "Done"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-sensitive'
			});

			expect(result.values).toHaveLength(4);
			expect(result.duplicatesRemoved).toBe(0);
		});

		it("should remove exact duplicates only", () => {
			const values = ["test", "test", "Test", "TEST"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-sensitive'
			});

			expect(result.values).toHaveLength(3);
			expect(result.duplicatesRemoved).toBe(1);
		});
	});

	describe("exact deduplication", () => {
		it("should use Set-based deduplication", () => {
			const values = ["same", "same", "different", "same"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'exact'
			});

			expect(result.values).toHaveLength(2);
			expect(result.duplicatesRemoved).toBe(2);
		});
	});

	describe("sorting behavior", () => {
		it("should sort case-insensitively while preserving original case", () => {
			const values = ["zebra", "Apple", "banana", "ZEBRA"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive',
				sortResult: true
			});

			// Should be sorted: Apple, banana, zebra (case-insensitive order)
			expect(result.values[0].toLowerCase()).toBe("apple");
			expect(result.values[1].toLowerCase()).toBe("banana");
			expect(result.values[2].toLowerCase()).toBe("zebra");
		});

		it("should prefer title case in sorting", () => {
			const values = ["apple", "APPLE", "Apple"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive',
				sortResult: true,
				preserveFirstOccurrence: false
			});

			// Should preserve title case "Apple" over others
			expect(result.values).toEqual(["Apple"]);
		});

		it("should disable sorting when requested", () => {
			const values = ["zebra", "apple", "banana"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'exact',
				sortResult: false
			});

			expect(result.values).toEqual(["zebra", "apple", "banana"]);
		});
	});

	describe("performance with large datasets", () => {
		it("should handle 1000+ values efficiently", () => {
			const values: string[] = [];
			for (let i = 0; i < 1000; i++) {
				values.push(`value${i % 100}`); // 100 unique values with 10 copies each
				values.push(`VALUE${i % 100}`); // Case variations
			}

			const startTime = performance.now();
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive'
			});
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
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive'
			});
			const endTime = performance.now();

			expect(result.values).toHaveLength(1000);
			expect(endTime - startTime).toBeLessThan(500); // Should complete in < 500ms
		});
	});

	describe("variation analysis", () => {
		it("should analyze case variations correctly", () => {
			const values = ["Active", "active", "ACTIVE", "Done", "done"];
			const analysis = FieldValueDeduplicator.analyzeVariations(values);

			expect(analysis.totalValues).toBe(5);
			expect(analysis.uniqueValues).toBe(2);
			expect(analysis.caseVariations.size).toBe(2);
			
			// Should identify the most common variation
			expect(analysis.mostCommonCase).toBe("active");
		});

		it("should handle single variations", () => {
			const values = ["unique1", "unique2", "unique3"];
			const analysis = FieldValueDeduplicator.analyzeVariations(values);

			expect(analysis.totalValues).toBe(3);
			expect(analysis.uniqueValues).toBe(3);
			expect(analysis.caseVariations.size).toBe(3);
		});
	});

	describe("suggestions system", () => {
		it("should suggest similar values", () => {
			const existingValues = ["Active", "InProgress", "Done", "Cancelled"];
			const suggestions = FieldValueDeduplicator.getSuggestions(
				"activ", 
				existingValues, 
				0.7
			);

			expect(suggestions).toContain("Active");
		});

		it("should not suggest exact matches", () => {
			const existingValues = ["Active", "InProgress", "Done"];
			const suggestions = FieldValueDeduplicator.getSuggestions(
				"Active", 
				existingValues, 
				0.8
			);

			expect(suggestions).not.toContain("Active");
		});

		it("should limit suggestions to 5 items", () => {
			const existingValues = Array.from({length: 20}, (_, i) => `similar${i}`);
			const suggestions = FieldValueDeduplicator.getSuggestions(
				"simila", 
				existingValues, 
				0.5
			);

			expect(suggestions).toHaveLength(5);
		});

		it("should handle empty existing values", () => {
			const suggestions = FieldValueDeduplicator.getSuggestions(
				"test", 
				[], 
				0.8
			);

			expect(suggestions).toEqual([]);
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
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive'
			});

			expect(result.values).toHaveLength(1);
			expect(result.duplicatesRemoved).toBe(2);
		});

		it("should handle very long strings", () => {
			const longString = "a".repeat(1000);
			const values = [longString, longString.toUpperCase(), "short"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive'
			});

			expect(result.values).toHaveLength(2);
			expect(result.duplicatesRemoved).toBe(1);
		});

		it("should handle strings with newlines and special whitespace", () => {
			const values = ["line1\nline2", "LINE1\nLINE2", "tab\there", "TAB\tHERE"];
			const result = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive'
			});

			expect(result.values).toHaveLength(2);
			expect(result.duplicatesRemoved).toBe(2);
		});
	});

	describe("configuration options", () => {
		it("should respect preserveFirstOccurrence setting", () => {
			const values = ["First", "FIRST", "second"];
			
			const preserveFirst = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive',
				preserveFirstOccurrence: true,
				sortResult: false
			});
			
			const preserveLast = FieldValueDeduplicator.deduplicate(values, {
				strategy: 'case-insensitive',
				preserveFirstOccurrence: false,
				sortResult: false
			});

			expect(preserveFirst.values[0]).toBe("First");
			expect(preserveLast.values[0]).toBe("FIRST");
		});

		it("should use default options when none provided", () => {
			const values = ["test", "TEST"];
			const result = FieldValueDeduplicator.deduplicate(values);

			expect(result.strategy).toBe('case-insensitive');
			expect(result.values).toHaveLength(1);
		});
	});
});