import { describe, expect, it } from "vitest";
import {
	buildSectionSubpath,
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
		expect(buildSectionSubpath(HEADINGS, 0 - 1)).toBeNull();
		// Cursor on a non-heading line before the first heading.
		const later: SimpleHeading[] = [{ heading: "Intro", level: 1, line: 5 }];
		expect(buildSectionSubpath(later, 2)).toBeNull();
	});

	it("picks the nearest heading at or above the cursor", () => {
		// Cursor on the heading line itself.
		expect(buildSectionSubpath(HEADINGS, 0)).toBe("#Parent A");
		// Cursor in the body under a unique heading.
		const unique: SimpleHeading[] = [
			{ heading: "Alpha", level: 1, line: 0 },
			{ heading: "Beta", level: 1, line: 5 },
		];
		expect(buildSectionSubpath(unique, 3)).toBe("#Alpha");
		expect(buildSectionSubpath(unique, 7)).toBe("#Beta");
	});

	it("disambiguates duplicate heading text with the ancestor path", () => {
		// Cursor under the SECOND "Notes" (line 8) -> #Parent B#Notes.
		expect(buildSectionSubpath(HEADINGS, 8)).toBe("#Parent B#Notes");
		// Cursor under the FIRST "Notes" (line 3) -> #Parent A#Notes.
		expect(buildSectionSubpath(HEADINGS, 3)).toBe("#Parent A#Notes");
	});

	it("does not add an ancestor path for unique headings", () => {
		expect(buildSectionSubpath(HEADINGS, 6)).toBe("#Parent B");
	});

	it("sanitizes structural characters in the chosen heading", () => {
		// Heading "Weird [x] | y # z" -> brackets kept, | and # flattened.
		expect(buildSectionSubpath(HEADINGS, 11)).toBe("#Weird [x] y z");
	});

	it("falls back (null) when the heading sanitizes to empty", () => {
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

	it("builds a multi-level ancestor chain for deep duplicates", () => {
		const deep: SimpleHeading[] = [
			{ heading: "A", level: 1, line: 0 },
			{ heading: "B", level: 2, line: 2 },
			{ heading: "C", level: 3, line: 4 },
			{ heading: "X", level: 1, line: 8 },
			{ heading: "B", level: 2, line: 10 },
			{ heading: "C", level: 3, line: 12 },
		];
		// Cursor under the second C -> full chain to level 1 (unique).
		expect(buildSectionSubpath(deep, 13)).toBe("#X#B#C");
	});

	it("returns null when even the full ancestor chain is ambiguous", () => {
		// Two identical "# A > ## B" structures -> #A#B for both -> unresolvable.
		const twins: SimpleHeading[] = [
			{ heading: "A", level: 1, line: 0 },
			{ heading: "B", level: 2, line: 2 },
			{ heading: "A", level: 1, line: 6 },
			{ heading: "B", level: 2, line: 8 },
		];
		expect(buildSectionSubpath(twins, 9)).toBeNull();
	});
});

describe("sanitizeHeadingForSubpath", () => {
	it("flattens subpath-breaking characters", () => {
		expect(sanitizeHeadingForSubpath("Weird [x] | y # z")).toBe(
			"Weird [x] y z",
		);
	});

	it("collapses wikilinks and embeds to their text", () => {
		expect(sanitizeHeadingForSubpath("See [[Page|Alias]] now")).toBe(
			"See Alias now",
		);
		expect(sanitizeHeadingForSubpath("Ref [[Page]]")).toBe("Ref Page");
		expect(sanitizeHeadingForSubpath("Img ![[pic.png]] end")).toBe(
			"Img end",
		);
	});

	it("trims and collapses whitespace", () => {
		expect(sanitizeHeadingForSubpath("  spaced   out  ")).toBe(
			"spaced out",
		);
	});
});
