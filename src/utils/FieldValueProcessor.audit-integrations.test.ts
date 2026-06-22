import { describe, it, expect } from "vitest";
import { FieldValueProcessor } from "./FieldValueProcessor";
import type { FieldFilter } from "./FieldSuggestionParser";

describe("FieldValueProcessor - default value case-folding (integrations audit)", () => {
	it("does not add a default that differs only by case from an existing value (default-always, case-insensitive)", () => {
		const rawValues = new Set(["Done", "Active"]);
		const filters: FieldFilter = {
			defaultValue: "done",
			defaultAlways: true,
		};

		const result = FieldValueProcessor.processValues(rawValues, filters);

		// Only one "done"-ish entry should exist, not both "done" and "Done".
		const doneVariants = result.values.filter(
			(v) => v.toLowerCase() === "done",
		);
		expect(doneVariants).toHaveLength(1);
		// The default replaces the existing variant and sits first.
		expect(result.values[0]).toBe("done");
		expect(result.values).toContain("Active");
		expect(result.hasDefaultValue).toBe(true);
	});

	it("does not prepend a default that differs only by case from an existing value (plain default, case-insensitive)", () => {
		const rawValues = new Set(["Done", "Active"]);
		const filters: FieldFilter = {
			defaultValue: "done",
		};

		const result = FieldValueProcessor.processValues(rawValues, filters);

		const doneVariants = result.values.filter(
			(v) => v.toLowerCase() === "done",
		);
		expect(doneVariants).toHaveLength(1);
		// Existing value is preserved, default is NOT added as a duplicate.
		expect(result.values).toContain("Done");
		expect(result.values).not.toContain("done");
		expect(result.hasDefaultValue).toBe(false);
	});

	it("folds accents when matching the default (case-insensitive)", () => {
		const rawValues = new Set(["Café"]);
		const filters: FieldFilter = {
			defaultValue: "cafe",
			defaultAlways: true,
		};

		const result = FieldValueProcessor.processValues(rawValues, filters);

		expect(result.values).toEqual(["cafe"]);
		expect(result.hasDefaultValue).toBe(true);
	});

	it("treats case-different default as distinct when case-sensitive is set", () => {
		const rawValues = new Set(["Done", "Active"]);
		const filters: FieldFilter = {
			defaultValue: "done",
			caseSensitive: true,
		};

		const result = FieldValueProcessor.processValues(rawValues, filters);

		// case-sensitive: "done" and "Done" are legitimately distinct entries.
		expect(result.values).toContain("done");
		expect(result.values).toContain("Done");
		expect(result.hasDefaultValue).toBe(true);
	});
});
