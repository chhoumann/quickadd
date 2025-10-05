import { describe, it, expect } from "vitest";
import { FieldValueProcessor } from "./FieldValueProcessor";
import type { FieldFilter } from "./FieldSuggestionParser";

describe("FieldValueProcessor", () => {
	describe("processValues", () => {
		it("should process values with case-insensitive deduplication by default", () => {
			const rawValues = new Set(["Active", "active", "ACTIVE", "Done"]);
			const filters: FieldFilter = {};

			const result = FieldValueProcessor.processValues(rawValues, filters);

			expect(result.values).toHaveLength(2);
			expect(result.duplicatesRemoved).toBe(2);
			expect(result.totalProcessed).toBe(4);
			expect(result.hasDefaultValue).toBe(false);
		});

		it("should use case-sensitive deduplication when specified", () => {
			const rawValues = new Set(["Active", "active", "ACTIVE", "Done"]);
			const filters: FieldFilter = { caseSensitive: true };

			const result = FieldValueProcessor.processValues(rawValues, filters);

			expect(result.values).toHaveLength(4);
			expect(result.duplicatesRemoved).toBe(0);
			expect(result.hasDefaultValue).toBe(false);
		});

		it("should add default value when defaultAlways is true", () => {
			const rawValues = new Set(["Active", "Done"]);
			const filters: FieldFilter = {
				defaultValue: "To Do",
				defaultAlways: true,
			};

			const result = FieldValueProcessor.processValues(rawValues, filters);

			expect(result.values[0]).toBe("To Do");
			expect(result.values).toContain("Active");
			expect(result.values).toContain("Done");
			expect(result.hasDefaultValue).toBe(true);
		});

		it("should add default value only when empty and defaultEmpty is true", () => {
			// Test with empty values
			const emptyValues = new Set<string>();
			const filters: FieldFilter = {
				defaultValue: "Default",
				defaultEmpty: true,
			};

			const result1 = FieldValueProcessor.processValues(emptyValues, filters);
			expect(result1.values).toEqual(["Default"]);
			expect(result1.hasDefaultValue).toBe(true);

			// Test with existing values
			const nonEmptyValues = new Set(["Existing"]);
			const result2 = FieldValueProcessor.processValues(
				nonEmptyValues,
				filters
			);
			expect(result2.values).toEqual(["Existing"]);
			expect(result2.hasDefaultValue).toBe(false);
		});

		it("should prepend default value when not already present (default behavior)", () => {
			const rawValues = new Set(["Active", "Done"]);
			const filters: FieldFilter = {
				defaultValue: "To Do",
			};

			const result = FieldValueProcessor.processValues(rawValues, filters);

			expect(result.values[0]).toBe("To Do");
			expect(result.values).toContain("Active");
			expect(result.values).toContain("Done");
			expect(result.hasDefaultValue).toBe(true);
		});

		it("should not duplicate default value if already present", () => {
			const rawValues = new Set(["To Do", "Active", "Done"]);
			const filters: FieldFilter = {
				defaultValue: "To Do",
			};

			const result = FieldValueProcessor.processValues(rawValues, filters);

			const toDoCount = result.values.filter((v) => v === "To Do").length;
			expect(toDoCount).toBe(1);
			expect(result.hasDefaultValue).toBe(false); // Already present, so no default added
		});
	});

	describe("getSmartDefaults", () => {
		it("should return common defaults for known field names", () => {
			const statusDefaults = FieldValueProcessor.getSmartDefaults("status", []);
			expect(statusDefaults).toContain("To Do");
			expect(statusDefaults).toContain("In Progress");
			expect(statusDefaults).toContain("Done");

			const priorityDefaults = FieldValueProcessor.getSmartDefaults(
				"priority",
				[]
			);
			expect(priorityDefaults).toContain("High");
			expect(priorityDefaults).toContain("Medium");
			expect(priorityDefaults).toContain("Low");
		});

		it("should find partial matches for field names", () => {
			const taskStatusDefaults = FieldValueProcessor.getSmartDefaults(
				"task_status",
				[]
			);
			expect(taskStatusDefaults).toContain("To Do");

			const projectPriorityDefaults = FieldValueProcessor.getSmartDefaults(
				"project-priority",
				[]
			);
			expect(projectPriorityDefaults).toContain("High");
		});

		it("should return most common existing values when no smart defaults match", () => {
			const existingValues = [
				"custom1",
				"custom1",
				"custom1",
				"custom2",
				"custom2",
				"custom3",
			];
			const defaults = FieldValueProcessor.getSmartDefaults(
				"unknown_field",
				existingValues
			);

			expect(defaults[0]).toBe("custom1"); // Most frequent
			expect(defaults[1]).toBe("custom2"); // Second most frequent
			expect(defaults[2]).toBe("custom3"); // Third most frequent
		});

		it("should return empty array for unknown fields with no existing values", () => {
			const defaults = FieldValueProcessor.getSmartDefaults(
				"completely_unknown",
				[]
			);
			expect(defaults).toEqual([]);
		});

		it("should limit suggestions to 5 items", () => {
			const manyValues = Array.from({ length: 20 }, (_, i) => `value${i}`);
			const defaults = FieldValueProcessor.getSmartDefaults(
				"unknown",
				manyValues
			);
			expect(defaults).toHaveLength(5);
		});
	});

	describe("validateDefaultValue", () => {
		it("should validate default value against existing patterns", () => {
			const existingValues = ["Active", "Done", "In Progress"];
			const validation = FieldValueProcessor.validateDefaultValue(
				"To Do",
				existingValues,
				"status"
			);

			expect(validation.isValid).toBe(true);
			expect(validation.warnings).toHaveLength(0);
		});

		it("should suggest existing case variations", () => {
			const existingValues = ["Active", "Done"];
			const validation = FieldValueProcessor.validateDefaultValue(
				"active",
				existingValues,
				"status"
			);

			expect(validation.suggestions).toContain("Active");
			expect(validation.warnings.some((w) => w.includes("existing case"))).toBe(
				true
			);
		});

		it("should suggest similar existing values", () => {
			const existingValues = ["In Progress", "Done"];
			const validation = FieldValueProcessor.validateDefaultValue(
				"In Progres",
				existingValues,
				"status"
			);

			expect(validation.suggestions).toContain("In Progress");
			expect(
				validation.warnings.some((w) => w.includes("Similar existing values"))
			).toBe(true);
		});

		it("should suggest smart defaults when applicable", () => {
			const existingValues: string[] = [];
			const validation = FieldValueProcessor.validateDefaultValue(
				"Custom",
				existingValues,
				"status"
			);

			expect(validation.suggestions).toContain("To Do");
			expect(validation.suggestions).toContain("In Progress");
			expect(
				validation.warnings.some((w) => w.includes("Consider common values"))
			).toBe(true);
		});

		it("should not duplicate suggestions", () => {
			const existingValues = ["To Do", "Done"];
			const validation = FieldValueProcessor.validateDefaultValue(
				"todo",
				existingValues,
				"status"
			);

			const uniqueSuggestions = new Set(validation.suggestions);
			expect(validation.suggestions.length).toBe(uniqueSuggestions.size);
		});

		it("should handle empty existing values gracefully", () => {
			const validation = FieldValueProcessor.validateDefaultValue(
				"Test",
				[],
				"unknown_field"
			);

			expect(validation.isValid).toBe(true);
			expect(validation.suggestions).toEqual([]);
		});
	});

	describe("edge cases", () => {
		it("should handle empty raw values", () => {
			const rawValues = new Set<string>();
			const filters: FieldFilter = {};

			const result = FieldValueProcessor.processValues(rawValues, filters);

			expect(result.values).toEqual([]);
			expect(result.duplicatesRemoved).toBe(0);
			expect(result.totalProcessed).toBe(0);
			expect(result.hasDefaultValue).toBe(false);
		});

		it("should handle filters with no default value", () => {
			const rawValues = new Set(["Value1", "Value2"]);
			const filters: FieldFilter = {
				defaultEmpty: true,
				defaultAlways: true,
				// No defaultValue specified
			};

			const result = FieldValueProcessor.processValues(rawValues, filters);

			expect(result.values).toHaveLength(2);
			expect(result.hasDefaultValue).toBe(false);
		});

		it("should handle very long default values", () => {
			const longDefault = "A".repeat(1000);
			const rawValues = new Set(["Short"]);
			const filters: FieldFilter = {
				defaultValue: longDefault,
				defaultAlways: true,
			};

			const result = FieldValueProcessor.processValues(rawValues, filters);

			expect(result.values[0]).toBe(longDefault);
			expect(result.hasDefaultValue).toBe(true);
		});

		it("should handle special characters in default values", () => {
			const specialDefault = "🚀 In Progress (高优先级)";
			const rawValues = new Set(["Done"]);
			const filters: FieldFilter = {
				defaultValue: specialDefault,
				defaultAlways: true,
			};

			const result = FieldValueProcessor.processValues(rawValues, filters);

			expect(result.values[0]).toBe(specialDefault);
			expect(result.hasDefaultValue).toBe(true);
		});
	});
});
