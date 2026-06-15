import { describe, expect, it } from "vitest";
import {
	buildSectionSubpath,
	extractHeadingsFromLines,
	sanitizeHeadingForSubpath,
	type SimpleHeading,
} from "./sectionLink";

// Mirrors the DupHeadings.md fixture used in the #387 spike.
const HEADINGS: SimpleHeading[] = [
	{ heading: "Parent A", level: 1, line: 0 },
	{ heading: "Notes", level: 2, line: 2 },
	{ heading: "Parent B", level: 1, line: 5 },
	{ heading: "Notes", level: 2, line: 7 },
	{ heading: "Weird [x] | y # z", level: 2, line: 10 },
];

describe("buildSectionSubpath", () => {
	it("returns null when there are no headings", () => {
		expect(buildSectionSubpath([], 3)).toBeNull();
	});

	it("returns null when the cursor is above the first heading", () => {
		const later: SimpleHeading[] = [{ heading: "Intro", level: 1, line: 5 }];
		expect(buildSectionSubpath(later, 2)).toBeNull();
	});

	it("picks the nearest heading at or above the cursor", () => {
		expect(buildSectionSubpath(HEADINGS, 0)).toBe("#Parent A");
		const unique: SimpleHeading[] = [
			{ heading: "Alpha", level: 1, line: 0 },
			{ heading: "Beta", level: 1, line: 5 },
		];
		expect(buildSectionSubpath(unique, 3)).toBe("#Alpha");
		expect(buildSectionSubpath(unique, 7)).toBe("#Beta");
	});

	it("disambiguates duplicate heading text with the ancestor path", () => {
		expect(buildSectionSubpath(HEADINGS, 8)).toBe("#Parent B#Notes");
		expect(buildSectionSubpath(HEADINGS, 3)).toBe("#Parent A#Notes");
	});

	it("does not add an ancestor path for unique headings", () => {
		expect(buildSectionSubpath(HEADINGS, 6)).toBe("#Parent B");
	});

	it("normalizes Obsidian-stripped characters in the chosen heading", () => {
		// "Weird [x] | y # z" -> brackets/pipe/hash all flattened (Obsidian's LT).
		expect(buildSectionSubpath(HEADINGS, 11)).toBe("#Weird x y z");
	});

	it("falls back (null) when the heading normalizes to empty", () => {
		const empty: SimpleHeading[] = [{ heading: "#", level: 1, line: 0 }];
		expect(buildSectionSubpath(empty, 2)).toBeNull();
	});

	it("returns null for level-1 duplicates (no ancestor can disambiguate)", () => {
		const dupTop: SimpleHeading[] = [
			{ heading: "Notes", level: 1, line: 0 },
			{ heading: "Notes", level: 1, line: 5 },
		];
		expect(buildSectionSubpath(dupTop, 6)).toBeNull();
	});

	it("returns null when a duplicate's only ancestor normalizes away", () => {
		// `# Parent A / ## Notes / # # / ## Notes`: the second Notes' only ancestor
		// ("#") sanitizes to empty, so the chain collapses to a bare "#Notes" which
		// would resolve to the FIRST Notes -> must fall back to whole-file (null).
		const tricky: SimpleHeading[] = [
			{ heading: "Parent A", level: 1, line: 0 },
			{ heading: "Notes", level: 2, line: 1 },
			{ heading: "#", level: 1, line: 2 },
			{ heading: "Notes", level: 2, line: 3 },
		];
		expect(buildSectionSubpath(tricky, 3)).toBeNull();
	});

	it("treats case-only differences as duplicates (Obsidian is case-insensitive)", () => {
		// `## Todo` then `## todo` with no disambiguating ancestor -> null, not a
		// bare `#todo` that would resolve to the first `Todo`.
		const caseDup: SimpleHeading[] = [
			{ heading: "Todo", level: 2, line: 0 },
			{ heading: "todo", level: 2, line: 5 },
		];
		expect(buildSectionSubpath(caseDup, 6)).toBeNull();
		// With distinct ancestors, the chain (compared case-insensitively) still
		// disambiguates and keeps the cursor heading's original case.
		const caseDupNested: SimpleHeading[] = [
			{ heading: "A", level: 1, line: 0 },
			{ heading: "Todo", level: 2, line: 1 },
			{ heading: "B", level: 1, line: 4 },
			{ heading: "todo", level: 2, line: 5 },
		];
		expect(buildSectionSubpath(caseDupNested, 6)).toBe("#B#todo");
	});

	it("builds a multi-level ancestor chain for deep duplicates", () => {
		const deep: SimpleHeading[] = [
			{ heading: "A", level: 1, line: 0 },
			{ heading: "B", level: 2, line: 2 },
			{ heading: "C", level: 3, line: 4 },
			{ heading: "X", level: 1, line: 8 },
			{ heading: "B", level: 2, line: 10 },
			{ heading: "C", level: 3, line: 12 },
		];
		expect(buildSectionSubpath(deep, 13)).toBe("#X#B#C");
	});

	it("returns null when even the full ancestor chain is ambiguous", () => {
		const twins: SimpleHeading[] = [
			{ heading: "A", level: 1, line: 0 },
			{ heading: "B", level: 2, line: 2 },
			{ heading: "A", level: 1, line: 6 },
			{ heading: "B", level: 2, line: 8 },
		];
		expect(buildSectionSubpath(twins, 9)).toBeNull();
	});
});

describe("sanitizeHeadingForSubpath (mirrors Obsidian's anchor normalizer)", () => {
	it("flattens the punctuation Obsidian strips from heading anchors", () => {
		expect(sanitizeHeadingForSubpath("Weird [x] | y # z")).toBe(
			"Weird x y z",
		);
		expect(sanitizeHeadingForSubpath("Plan]")).toBe("Plan");
		expect(sanitizeHeadingForSubpath("a ]] b")).toBe("a b");
	});

	it("neutralizes braces so embedded QuickAdd tokens can't be re-resolved", () => {
		expect(sanitizeHeadingForSubpath("{{TITLE}}")).toBe("TITLE");
		expect(sanitizeHeadingForSubpath("{{FILENAMECURRENT}}")).toBe(
			"FILENAMECURRENT",
		);
	});

	it("flattens wikilinks/embeds the same way Obsidian's anchor does", () => {
		expect(sanitizeHeadingForSubpath("See [[Page|Alias]] now")).toBe(
			"See Page Alias now",
		);
		expect(sanitizeHeadingForSubpath("Ref [[Page]]")).toBe("Ref Page");
		expect(sanitizeHeadingForSubpath("Img ![[pic.png]] end")).toBe(
			"Img pic png end",
		);
	});

	it("trims and collapses whitespace (incl. stray CR)", () => {
		expect(sanitizeHeadingForSubpath("  spaced   out  ")).toBe("spaced out");
		expect(sanitizeHeadingForSubpath("tail\r")).toBe("tail");
	});
});

describe("extractHeadingsFromLines", () => {
	it("extracts ATX headings with level and line", () => {
		const lines = ["# A", "body", "## B", "more"];
		expect(extractHeadingsFromLines(lines)).toEqual([
			{ heading: "A", level: 1, line: 0 },
			{ heading: "B", level: 2, line: 2 },
		]);
	});

	it("skips # lines inside fenced code blocks", () => {
		const lines = [
			"# Real",
			"```js",
			"# not a heading",
			"```",
			"## Also Real",
		];
		expect(extractHeadingsFromLines(lines)).toEqual([
			{ heading: "Real", level: 1, line: 0 },
			{ heading: "Also Real", level: 2, line: 4 },
		]);
	});

	it("does not let an info-string fence line close an open fence", () => {
		// ```ruby inside an open ``` block is content, not a close (CommonMark);
		// only the bare ``` closes it, so "# b" stays inside the fence.
		const lines = [
			"```",
			"# a in fence",
			"```ruby",
			"# b still in fence",
			"```",
			"# Real",
		];
		expect(extractHeadingsFromLines(lines)).toEqual([
			{ heading: "Real", level: 1, line: 5 },
		]);
	});

	it("handles ~~~ fences too", () => {
		const lines = ["~~~", "# fenced", "~~~", "# Real"];
		expect(extractHeadingsFromLines(lines)).toEqual([
			{ heading: "Real", level: 1, line: 3 },
		]);
	});

	it("bounds the level to 1-6 (7 hashes is not a heading)", () => {
		expect(extractHeadingsFromLines(["####### Seven"])).toEqual([]);
		expect(extractHeadingsFromLines(["###### Six"])).toEqual([
			{ heading: "Six", level: 6, line: 0 },
		]);
	});

	it("requires a space after the hashes", () => {
		expect(extractHeadingsFromLines(["#NoSpace", "#tag"])).toEqual([]);
	});

	it("skips YAML frontmatter", () => {
		const lines = ["---", "title: x", "# not a heading", "---", "# Real"];
		expect(extractHeadingsFromLines(lines)).toEqual([
			{ heading: "Real", level: 1, line: 4 },
		]);
	});

	it("parses setext headings (=== / ---)", () => {
		expect(extractHeadingsFromLines(["Title", "===", "body"])).toEqual([
			{ heading: "Title", level: 1, line: 0 },
		]);
		expect(extractHeadingsFromLines(["Sub", "---", "body"])).toEqual([
			{ heading: "Sub", level: 2, line: 0 },
		]);
	});

	it("falls back (no heading) for a multi-line setext paragraph", () => {
		// Obsidian would make the whole "Long title" paragraph the heading; rather
		// than reconstruct that we emit nothing so we never produce a partial anchor.
		expect(extractHeadingsFromLines(["Long", "title", "==="])).toEqual([]);
		// A single-line paragraph still works.
		expect(extractHeadingsFromLines(["", "title", "==="])).toEqual([
			{ heading: "title", level: 1, line: 1 },
		]);
	});

	it("recognizes a setext first heading right after frontmatter close", () => {
		// No blank line after the closing `---`; the delimiter must not be treated
		// as the paragraph continuing upward (which would skip the heading).
		const lines = ["---", "title: x", "---", "Title", "===", "body"];
		expect(extractHeadingsFromLines(lines)).toEqual([
			{ heading: "Title", level: 1, line: 3 },
		]);
	});

	it("recognizes a setext heading right after a thematic break", () => {
		expect(extractHeadingsFromLines(["***", "Title", "==="])).toEqual([
			{ heading: "Title", level: 1, line: 1 },
		]);
	});

	it("does not mistake a thematic break or list dashes for a setext underline", () => {
		// `---` after a blank line is a thematic break, not a setext underline.
		expect(extractHeadingsFromLines(["text", "", "---"])).toEqual([]);
		// A list's dashes are not underlines.
		expect(extractHeadingsFromLines(["- a", "- b"])).toEqual([]);
	});

	it("does not double-count an ATX heading followed by ---", () => {
		expect(extractHeadingsFromLines(["# H", "---"])).toEqual([
			{ heading: "H", level: 1, line: 0 },
		]);
	});

	it("ignores setext underlines inside fenced code", () => {
		const lines = ["```", "Title", "===", "```", "# Real"];
		expect(extractHeadingsFromLines(lines)).toEqual([
			{ heading: "Real", level: 1, line: 4 },
		]);
	});

	it("allows up to 3 leading spaces but not a leading tab (code line)", () => {
		expect(extractHeadingsFromLines(["   # Indented"])).toEqual([
			{ heading: "Indented", level: 1, line: 0 },
		]);
		// 4+ spaces or a leading tab => indented code, not a heading.
		expect(extractHeadingsFromLines(["    # Code"])).toEqual([]);
		expect(extractHeadingsFromLines(["\t# Code"])).toEqual([]);
	});
});
