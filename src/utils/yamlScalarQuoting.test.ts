import { describe, expect, it } from "vitest";
import { quoteYamlDouble, wouldYamlMisCoerce } from "./yamlScalarQuoting";

describe("wouldYamlMisCoerce", () => {
	// The exact set Obsidian's YAML parser coerces to a non-string, pinned
	// empirically against a live metadataCache probe.
	const COERCES = [
		"42",
		"-7",
		"+5",
		"0042",
		"00",
		"-0",
		"3.5",
		".5",
		"5.",
		"1e3",
		"2e10",
		"0x1F",
		"0o17",
		".inf",
		"-.inf",
		".Inf",
		".nan",
		".NaN",
		"true",
		"True",
		"TRUE",
		"false",
		"False",
		"FALSE",
		"null",
		"Null",
		"NULL",
		"~",
	];

	// Obsidian keeps these as STRINGS — quoting them would be needless churn.
	const STAYS_STRING = [
		"yes",
		"no",
		"on",
		"off",
		"YES",
		"Off",
		"tRue", // mixed case
		"1000_000", // underscores
		"2025-12-25", // date
		"2025-12-25T15:30:00", // datetime
		"12:30", // sexagesimal
		"1:02:03",
		"0b101", // binary
		"1.2.3",
		"0x", // incomplete
		"1e",
		"1,000",
		"hello",
		"007abc",
		"", // empty
		"   ", // whitespace
	];

	it.each(COERCES)("treats %s as coercion-prone", (value) => {
		expect(wouldYamlMisCoerce(value)).toBe(true);
	});

	it.each(STAYS_STRING)("leaves %s as a string", (value) => {
		expect(wouldYamlMisCoerce(value)).toBe(false);
	});
});

describe("quoteYamlDouble", () => {
	it("wraps a plain value in double quotes", () => {
		expect(quoteYamlDouble("0042")).toBe('"0042"');
		expect(quoteYamlDouble("true")).toBe('"true"');
	});

	it("escapes embedded double quotes and backslashes", () => {
		expect(quoteYamlDouble('he said "hi"')).toBe('"he said \\"hi\\""');
		expect(quoteYamlDouble("a\\b")).toBe('"a\\\\b"');
	});
});
