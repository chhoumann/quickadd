import { describe, it, expect } from "vitest";
import type { App, TFile } from "obsidian";
import {
	resolveFieldDefaultFromFrontmatter,
	resolveActiveNoteFieldDefault,
} from "./activeNoteFieldDefault";

describe("resolveFieldDefaultFromFrontmatter (issue #1429)", () => {
	it("returns a trimmed string for a scalar string value", () => {
		expect(
			resolveFieldDefaultFromFrontmatter(
				{ project: "  The Great Endeavor  " },
				"project",
			),
		).toBe("The Great Endeavor");
	});

	it("stringifies a number scalar (including 0)", () => {
		expect(resolveFieldDefaultFromFrontmatter({ year: 2026 }, "year")).toBe(
			"2026",
		);
		expect(resolveFieldDefaultFromFrontmatter({ count: 0 }, "count")).toBe("0");
	});

	it("stringifies a boolean scalar (including false)", () => {
		expect(resolveFieldDefaultFromFrontmatter({ done: true }, "done")).toBe(
			"true",
		);
		expect(resolveFieldDefaultFromFrontmatter({ done: false }, "done")).toBe(
			"false",
		);
	});

	it("returns a list of trimmed scalar strings for a YAML list value", () => {
		expect(
			resolveFieldDefaultFromFrontmatter(
				{ topics: ["Alpha", " Beta ", 3, true] },
				"topics",
			),
		).toEqual(["Alpha", "Beta", "3", "true"]);
	});

	it("drops null and object entries inside a list", () => {
		expect(
			resolveFieldDefaultFromFrontmatter(
				{ topics: ["Alpha", null, { a: 1 }, "Beta"] },
				"topics",
			),
		).toEqual(["Alpha", "Beta"]);
	});

	it("returns null for a missing property", () => {
		expect(
			resolveFieldDefaultFromFrontmatter({ other: "x" }, "project"),
		).toBeNull();
	});

	it("returns null for a null property", () => {
		expect(
			resolveFieldDefaultFromFrontmatter({ project: null }, "project"),
		).toBeNull();
	});

	it("returns null for an empty/whitespace string scalar", () => {
		expect(
			resolveFieldDefaultFromFrontmatter({ project: "" }, "project"),
		).toBeNull();
		expect(
			resolveFieldDefaultFromFrontmatter({ project: "   " }, "project"),
		).toBeNull();
	});

	it("returns null for an empty list", () => {
		expect(
			resolveFieldDefaultFromFrontmatter({ topics: [] }, "topics"),
		).toBeNull();
	});

	it("returns null for a list of only non-scalar entries", () => {
		expect(
			resolveFieldDefaultFromFrontmatter(
				{ topics: [null, { a: 1 }, [1, 2]] },
				"topics",
			),
		).toBeNull();
	});

	it("returns null for an object/map value", () => {
		expect(
			resolveFieldDefaultFromFrontmatter(
				{ meta: { nested: "value" } },
				"meta",
			),
		).toBeNull();
	});

	it("returns null when there is no frontmatter", () => {
		expect(resolveFieldDefaultFromFrontmatter(undefined, "project")).toBeNull();
		expect(resolveFieldDefaultFromFrontmatter(null, "project")).toBeNull();
	});

	it("returns null for an empty field name", () => {
		expect(
			resolveFieldDefaultFromFrontmatter({ project: "x" }, "   "),
		).toBeNull();
	});

	it("matches the key case-sensitively first", () => {
		expect(
			resolveFieldDefaultFromFrontmatter(
				{ project: "lower", Project: "upper" },
				"Project",
			),
		).toBe("upper");
	});

	it("falls back to a case-insensitive key match (Obsidian Properties are case-insensitive)", () => {
		expect(
			resolveFieldDefaultFromFrontmatter({ project: "Endeavor" }, "Project"),
		).toBe("Endeavor");
	});
});

describe("resolveActiveNoteFieldDefault (issue #1429)", () => {
	function makeApp(
		file: TFile | null,
		frontmatter: Record<string, unknown> | undefined,
	): App {
		return {
			metadataCache: {
				getFileCache: (f: TFile) =>
					f === file ? { frontmatter } : null,
			},
		} as unknown as App;
	}

	const mdFile = { extension: "md", path: "Active.md" } as unknown as TFile;

	it("reads the active note's frontmatter property", () => {
		const app = makeApp(mdFile, { project: "The Great Endeavor" });
		expect(resolveActiveNoteFieldDefault(app, mdFile, "project")).toBe(
			"The Great Endeavor",
		);
	});

	it("returns null when there is no active file", () => {
		const app = makeApp(null, undefined);
		expect(resolveActiveNoteFieldDefault(app, null, "project")).toBeNull();
		expect(
			resolveActiveNoteFieldDefault(app, undefined, "project"),
		).toBeNull();
	});

	it("returns null for a non-Markdown active file (Canvas/PDF/etc.)", () => {
		const canvas = {
			extension: "canvas",
			path: "Board.canvas",
		} as unknown as TFile;
		const app = makeApp(canvas, { project: "x" });
		expect(resolveActiveNoteFieldDefault(app, canvas, "project")).toBeNull();
	});

	it("returns null when the note has no frontmatter", () => {
		const app = makeApp(mdFile, undefined);
		expect(resolveActiveNoteFieldDefault(app, mdFile, "project")).toBeNull();
	});

	it("returns a list value for a YAML list property", () => {
		const app = makeApp(mdFile, { topics: ["Alpha", "Beta"] });
		expect(resolveActiveNoteFieldDefault(app, mdFile, "topics")).toEqual([
			"Alpha",
			"Beta",
		]);
	});
});
