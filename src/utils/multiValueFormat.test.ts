import { describe, expect, it, vi } from "vitest";
import {
	parseMultiValueFormat,
	renderExplicitMultiValue,
} from "./multiValueFormat";

describe("multi-select output formatting", () => {
	it.each(["auto", "inline", "yaml", "markdown"] as const)(
		"parses %s",
		(format) => {
			expect(parseMultiValueFormat(format, "token")).toBe(format);
		},
	);

	it("warns and ignores unsupported formats", () => {
		const warn = vi.fn();
		expect(parseMultiValueFormat("table", "token", warn)).toBeUndefined();
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("auto, inline, yaml, markdown"),
		);
	});

	it("keeps auto available to the legacy context-sensitive renderer", () => {
		expect(
			renderExplicitMultiValue({
				input: "{{VALUE:a,b|multi}}",
				matchStart: 0,
				values: ["a", "b"],
				format: "auto",
			}),
		).toBeUndefined();
	});

	it("renders inline output with the legacy comma separator", () => {
		expect(
			renderExplicitMultiValue({
				input: "value",
				matchStart: 0,
				values: ["Alpha", "Beta"],
				format: "inline",
			}),
		).toBe("Alpha,Beta");
	});

	it("renders a quoted YAML flow sequence that preserves string values", () => {
		expect(
			renderExplicitMultiValue({
				input: "topics: token",
				matchStart: 8,
				values: ["0042", "a: b", 'quoted "value"'],
				format: "yaml",
			}),
		).toBe('["0042", "a: b", "quoted \\"value\\""]');
	});

	it("renders an empty YAML selection as an empty list", () => {
		expect(
			renderExplicitMultiValue({
				input: "topics: token",
				matchStart: 8,
				values: [],
				format: "yaml",
			}),
		).toBe("[]");
	});

	it("renders an indented vertical Markdown list", () => {
		expect(
			renderExplicitMultiValue({
				input: "  token",
				matchStart: 2,
				values: ["Alpha", "Beta\ncontinued"],
				format: "markdown",
			}),
		).toBe("- Alpha\n  - Beta\n  continued");
	});
});
