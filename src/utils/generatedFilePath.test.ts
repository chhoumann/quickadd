import { describe, expect, it } from "vitest";
import { normalizeGeneratedFilePath } from "./generatedFilePath";

describe("normalizeGeneratedFilePath", () => {
	it.each([
		["folds trailing line breaks out of file names", "This is the VALUE\n", "This is the VALUE"],
		["does not create a leading space for a leading line break", "\nThis is the VALUE", "This is the VALUE"],
		["folds internal control characters to one linkable space", "This\r\n\tis the VALUE", "This is the VALUE"],
		["folds unicode line separators to one linkable space", "Line\u2028Separator", "Line Separator"],
		["preserves ordinary leading and repeated spaces", "  Leading  Spaces", "  Leading  Spaces"],
		["strips trailing spaces and periods from generated path segments", "Folder. /Note. ", "Folder/Note"],
		["preserves folder separators while normalizing each segment", "Folder/Line\nBreak", "Folder/Line Break"],
	] as const)("%s", (_name, input, expected) => {
		expect(normalizeGeneratedFilePath(input)).toBe(
			expected,
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

	it("rejects backslash traversal (Windows-style ..\\) that the slash-only split missed", () => {
		// Regression for the path-traversal finding: a backslash is a real path
		// separator to Obsidian's vault.create, so "..\\..\\..\\evil" must be
		// rejected, not preserved as a single non-".." segment.
		expect(() => normalizeGeneratedFilePath("..\\..\\..\\evil")).toThrow(
			'File path cannot contain "." or ".." path segments.',
		);
		expect(() => normalizeGeneratedFilePath("Folder\\..\\Note")).toThrow(
			'File path cannot contain "." or ".." path segments.',
		);
	});

	it("treats a backslash as a folder separator, mirroring Obsidian's normalizePath", () => {
		expect(normalizeGeneratedFilePath("Folder\\Note")).toBe("Folder/Note");
		expect(normalizeGeneratedFilePath("a\\b\\Line\nBreak")).toBe(
			"a/b/Line Break",
		);
	});

	// The historical control-run collapse (` *[<control>]+ *` global) and the
	// two trailing trims (/ +$/u, /[. ]+$/u) all backtracked quadratically on
	// long interior space/dot runs - and these names embed untrusted format
	// output ({{VALUE}}/{{CLIPBOARD}}). The linear scanners were proven
	// byte-identical by a 3.36M-case differential fuzz (incl. exhaustive
	// coverage of all strings up to length 6 over the control/space/dot
	// alphabet, comparing thrown messages too). These pin the linear-time
	// behavior; budgets are generous to stay non-flaky (the old code took
	// seconds at these sizes).
	describe("ReDoS resistance", () => {
		const BUDGET_MS = 1000;
		const N = 200_000;

		it.each([
			["interior space run", "a" + " ".repeat(N) + "b"],
			["interior dot run", "a" + ".".repeat(N) + "b"],
			["interior dot/space mix", "a" + ". ".repeat(N / 2) + "b"],
		])("normalizes a %s in linear time", (_name, input) => {
			const start = performance.now();
			expect(normalizeGeneratedFilePath(input)).toBe(input);
			expect(performance.now() - start).toBeLessThan(BUDGET_MS);
		}, 20_000);
	});
});
