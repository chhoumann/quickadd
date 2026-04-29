import { describe, expect, it } from "vitest";
import {
	filterFolderPathsWithinRoots,
	isFolderPathWithinRoot,
	sortFolderPathsByTree,
} from "./folder-sorting";

describe("sortFolderPathsByTree", () => {
	it("keeps parent folders before their child subtree", () => {
		expect(
			sortFolderPathsByTree([
				"A/B2/C1",
				"A/B1",
				"A/B3/C2",
				"A/B3",
				"A/B1/C2",
				"A",
				"A/B2",
				"A/B1/C1",
				"A/B3/C1",
			]),
		).toEqual([
			"A",
			"A/B1",
			"A/B1/C1",
			"A/B1/C2",
			"A/B2",
			"A/B2/C1",
			"A/B3",
			"A/B3/C1",
			"A/B3/C2",
		]);
	});

	it("uses natural case-insensitive ordering for path segments", () => {
		expect(sortFolderPathsByTree(["A/B10", "A/b2", "A/B1"])).toEqual([
			"A/B1",
			"A/b2",
			"A/B10",
		]);
	});

	it("sorts root-like folder paths before nested folders", () => {
		const sorted = sortFolderPathsByTree(["A/B", "/", "A", ""]);

		expect(sorted.slice(0, 2)).toEqual(expect.arrayContaining(["/", ""]));
		expect(sorted.indexOf("A")).toBeGreaterThanOrEqual(2);
		expect(sorted.indexOf("A/B")).toBeGreaterThan(sorted.indexOf("A"));
	});

	it("preserves duplicate paths for callers to deduplicate explicitly", () => {
		expect(sortFolderPathsByTree(["A/B", "A", "A/B"])).toEqual([
			"A",
			"A/B",
			"A/B",
		]);
	});
});

describe("isFolderPathWithinRoot", () => {
	it("matches the root folder and descendants", () => {
		expect(isFolderPathWithinRoot("A", "A")).toBe(true);
		expect(isFolderPathWithinRoot("A/B1", "A")).toBe(true);
		expect(isFolderPathWithinRoot("A/B1/C1", "A")).toBe(true);
	});

	it("does not match plain sibling prefixes", () => {
		expect(isFolderPathWithinRoot("A2", "A")).toBe(false);
		expect(isFolderPathWithinRoot("A2/B1", "A")).toBe(false);
	});

	it("normalizes leading and trailing slashes before matching", () => {
		expect(isFolderPathWithinRoot("/A/B1/", "A/")).toBe(true);
		expect(isFolderPathWithinRoot("/A2/B1/", "A/")).toBe(false);
	});
});

describe("filterFolderPathsWithinRoots", () => {
	it("keeps only roots and descendants without leaking sibling prefixes", () => {
		expect(
			filterFolderPathsWithinRoots(
				["A", "A/B1", "A/B1/C1", "A2", "A2/B1", "B/B1"],
				["A"],
			),
		).toEqual(["A", "A/B1", "A/B1/C1"]);
	});
});
