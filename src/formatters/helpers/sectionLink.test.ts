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

	// The chain-collision check now precomputes every heading's chain key with a
	// forward outline-parent stack instead of re-walking ancestorChain inside a
	// .some() (O(H^2) on duplicate-flooded notes). This property test pins the
	// stack-based chains to the original backward-walk semantics.
	it("matches the backward-walk reference on randomized outlines", () => {
		// Reference: the pre-optimization ancestorChain, verbatim.
		const referenceChain = (headings: SimpleHeading[], index: number) => {
			const segments: string[] = [];
			const self = sanitizeHeadingForSubpath(headings[index].heading);
			if (self) segments.push(self);
			let level = headings[index].level;
			for (let i = index - 1; i >= 0 && level > 1; i--) {
				if (headings[i].level < level) {
					level = headings[i].level;
					const seg = sanitizeHeadingForSubpath(headings[i].heading);
					if (seg) segments.unshift(seg);
				}
			}
			return segments;
		};
		const referenceSubpath = (
			headings: SimpleHeading[],
			cursorLine: number,
		): string | null => {
			if (headings.length === 0) return null;
			let targetIndex = -1;
			for (let i = 0; i < headings.length; i++) {
				if (headings[i].line <= cursorLine) targetIndex = i;
				else break;
			}
			if (targetIndex === -1) return null;
			const targetText = sanitizeHeadingForSubpath(
				headings[targetIndex].heading,
			);
			if (!targetText) return null;
			const targetKey = targetText.toLowerCase();
			const isUniqueText = !headings.some(
				(h, i) =>
					i !== targetIndex &&
					sanitizeHeadingForSubpath(h.heading).toLowerCase() === targetKey,
			);
			if (isUniqueText) return `#${targetText}`;
			const chain = referenceChain(headings, targetIndex);
			if (chain.length < 2) return null;
			const chainKey = chain.join("#");
			const chainKeyLower = chainKey.toLowerCase();
			const isUniqueChain = !headings.some(
				(_h, i) =>
					i !== targetIndex &&
					referenceChain(headings, i).join("#").toLowerCase() ===
						chainKeyLower,
			);
			if (!isUniqueChain) return null;
			return `#${chainKey}`;
		};

		// Deterministic PRNG so failures reproduce.
		let seed = 0x5eed;
		const rand = () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		const NAMES = ["Notes", "notes", "Log", "#", "A", "B", ""];
		for (let round = 0; round < 2000; round++) {
			const count = 1 + Math.floor(rand() * 12);
			const headings: SimpleHeading[] = [];
			for (let i = 0; i < count; i++) {
				headings.push({
					heading: NAMES[Math.floor(rand() * NAMES.length)],
					level: 1 + Math.floor(rand() * 4),
					line: i * 2,
				});
			}
			const cursorLine = Math.floor(rand() * (count * 2 + 2));
			expect(buildSectionSubpath(headings, cursorLine)).toBe(
				referenceSubpath(headings, cursorLine),
			);
		}
	});

	it("resolves duplicates on a heading-flooded note in linear time", () => {
		// 30k duplicate headings: the old O(H^2) collision check took minutes
		// here; the stack-based precompute stays well under the budget.
		const flood: SimpleHeading[] = [];
		for (let i = 0; i < 15_000; i++) {
			flood.push({ heading: `Parent ${i}`, level: 1, line: i * 4 });
			flood.push({ heading: "Notes", level: 2, line: i * 4 + 2 });
		}
		const start = performance.now();
		expect(buildSectionSubpath(flood, 42)).toBe("#Parent 10#Notes");
		expect(performance.now() - start).toBeLessThan(1000);
	}, 20_000);
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
