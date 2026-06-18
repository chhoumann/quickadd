import { describe, expect, it } from "vitest";
import { normalizeGeneratedFilePath } from "./generatedFilePath";

describe("normalizeGeneratedFilePath", () => {
	it("folds trailing line breaks out of file names", () => {
		expect(normalizeGeneratedFilePath("This is the VALUE\n")).toBe(
			"This is the VALUE",
		);
	});

	it("does not create a leading space for a leading line break", () => {
		expect(normalizeGeneratedFilePath("\nThis is the VALUE")).toBe(
			"This is the VALUE",
		);
	});

	it("folds internal control characters to one linkable space", () => {
		expect(normalizeGeneratedFilePath("This\r\n\tis the VALUE")).toBe(
			"This is the VALUE",
		);
	});

	it("folds unicode line separators to one linkable space", () => {
		expect(normalizeGeneratedFilePath("Line\u2028Separator")).toBe(
			"Line Separator",
		);
	});

	it("preserves ordinary leading and repeated spaces", () => {
		expect(normalizeGeneratedFilePath("  Leading  Spaces")).toBe(
			"  Leading  Spaces",
		);
	});

	it("strips trailing spaces and periods from generated path segments", () => {
		expect(normalizeGeneratedFilePath("Folder. /Note. ")).toBe(
			"Folder/Note",
		);
	});

	it("preserves folder separators while normalizing each segment", () => {
		expect(normalizeGeneratedFilePath("Folder/Line\nBreak")).toBe(
			"Folder/Line Break",
		);
	});

	it("preserves leading and trailing folder separators", () => {
		expect(normalizeGeneratedFilePath("/Projects/Issue 221")).toBe(
			"/Projects/Issue 221",
		);
		expect(normalizeGeneratedFilePath("journals/")).toBe("journals/");
	});

	it("rejects segments that become empty after formatting", () => {
		expect(() => normalizeGeneratedFilePath("Folder/\n/Note")).toThrow(
			"File path contains an empty path segment after formatting.",
		);
	});

	it("rejects direct empty path segments", () => {
		expect(() => normalizeGeneratedFilePath("Folder//Note")).toThrow(
			"File path contains an empty path segment after formatting.",
		);
	});

	it("rejects dot traversal segments after formatting", () => {
		expect(() => normalizeGeneratedFilePath("Folder/../Note")).toThrow(
			'File path cannot contain "." or ".." path segments.',
		);
	});
});
