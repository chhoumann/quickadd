import { describe, expect, it } from "vitest";
import {
	computeOrderedSectionInsertIndex,
	type MomentLike,
} from "./orderedSectionPlacement";
import type { SectionOrdering } from "../../types/choices/ICaptureChoice";

/**
 * A real-enough, lenient date parser injected so the date comparator is exercised
 * for real (the obsidian-stub `moment` is a no-op). Deliberately supports
 * "DD-MM-YYYY" — whose lexical order disagrees with chronological order — so a
 * test can prove the date path is not secretly falling back to lexical. Leniency:
 * the leading date prefix is matched and trailing decoration ignored.
 */
function makeFakeMoment(): MomentLike {
	return (input: string, format?: string) => {
		let value = Number.NaN;
		if (format === "DD-MM-YYYY") {
			const m = input.match(/^(\d{2})-(\d{2})-(\d{4})/);
			if (m) value = Date.UTC(+m[3], +m[2] - 1, +m[1]);
		} else if (format === "YYYY") {
			const m = input.match(/^(\d{4})/);
			if (m) value = Date.UTC(+m[1], 0, 1);
		} else {
			// default / "YYYY-MM-DD"
			const m = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
			if (m) value = Date.UTC(+m[1], +m[2] - 1, +m[3]);
		}
		return { isValid: () => !Number.isNaN(value), valueOf: () => value };
	};
}

const ob = (over: Partial<SectionOrdering>): SectionOrdering => ({
	by: "insertion",
	direction: "desc",
	unparseable: "bottom",
	...over,
});

describe("computeOrderedSectionInsertIndex", () => {
	describe("zero siblings", () => {
		it("nests after the ancestor's whole section (preamble pinned) — R1", () => {
			const lines = [
				"# My Daily Log",
				"A running journal.",
				"",
			];
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 2026-06-16",
				2,
				ob({ by: "date", dateFormat: "YYYY-MM-DD" }),
				makeFakeMoment(),
			);
			// after the last non-empty preamble line ("A running journal." = index 1)
			expect(slot).toEqual({ mode: "after", line: 1 });
		});

		it("falls back to bodyStart when there is no ancestor heading", () => {
			const lines = ["", "- loose note", ""];
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 2026",
				2,
				ob({}),
			);
			expect(slot).toEqual({ mode: "bodyStart" });
		});
	});

	describe("insertion order", () => {
		const lines = ["# Log", "", "## B", "- x", "", "## A", "- y"];
		it("desc prepends before the first sibling", () => {
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## C",
				2,
				ob({ by: "insertion", direction: "desc" }),
			);
			expect(slot).toEqual({ mode: "before", line: 2 }); // before "## B"
		});
		it("asc appends after the last sibling's section end", () => {
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## C",
				2,
				ob({ by: "insertion", direction: "asc" }),
			);
			expect(slot).toEqual({ mode: "after", line: 6 }); // after "- y"
		});
	});

	describe("lexical", () => {
		const lines = ["# Meetings", "", "## Globex", "- standup"];
		it("asc places Acme before Globex", () => {
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## Acme",
				2,
				ob({ by: "lexical", direction: "asc" }),
			);
			expect(slot).toEqual({ mode: "before", line: 2 });
		});
		it("is case-insensitive", () => {
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## acme",
				2,
				ob({ by: "lexical", direction: "asc" }),
			);
			expect(slot).toEqual({ mode: "before", line: 2 });
		});
	});

	describe("numeric", () => {
		const lines = ["# Items", "", "## 2. Two", "- a", "", "## 1. One", "- b"];
		it("desc places higher number on top, tolerating decoration", () => {
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 3. Three",
				2,
				ob({ by: "numeric", direction: "desc" }),
			);
			expect(slot).toEqual({ mode: "before", line: 2 }); // before "## 2. Two"
		});
	});

	describe("date (injected moment, non-lexical format)", () => {
		// Lexical order of these DD-MM-YYYY strings DISAGREES with chronology, so a
		// correct result proves the date comparator is used, not lexical.
		const lines = [
			"# Log",
			"",
			"## 31-12-2025 (Wed)",
			"- old",
			"",
			"## 01-06-2025",
			"- older",
		];
		it("desc places the newer date on top despite lexical order", () => {
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 01-01-2026 (Thu)",
				2,
				ob({ by: "date", dateFormat: "DD-MM-YYYY", direction: "desc" }),
				makeFakeMoment(),
			);
			// 2026-01-01 is newest → before the first sibling (31-12-2025)
			expect(slot).toEqual({ mode: "before", line: 2 });
		});
		it("places a middle date in its chronological slot", () => {
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 15-09-2025",
				2,
				ob({ by: "date", dateFormat: "DD-MM-YYYY", direction: "desc" }),
				makeFakeMoment(),
			);
			// 2025-09-15 is between 2025-12-31 and 2025-06-01 → before the 01-06-2025 sibling
			expect(slot).toEqual({ mode: "before", line: 5 });
		});
		it("without an injected moment, a date key is unparseable → appended", () => {
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 01-01-2026",
				2,
				ob({ by: "date", dateFormat: "DD-MM-YYYY", direction: "desc" }),
				// no moment
			);
			expect(slot).toEqual({ mode: "after", line: 6 });
		});
	});

	describe("semver", () => {
		const lines = ["# Changelog", "", "## 1.9.0", "- old fix"];
		it("places 1.10.0 above 1.9.0 (not lexical)", () => {
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 1.10.0",
				2,
				ob({ by: "semver", direction: "desc" }),
			);
			expect(slot).toEqual({ mode: "before", line: 2 });
		});
		it("does not alias across segments (clamp)", () => {
			const big = ["# C", "", "## 2.0.0", "- x"];
			const slot = computeOrderedSectionInsertIndex(
				big,
				"## 1.999999.0",
				2,
				ob({ by: "semver", direction: "desc" }),
			);
			// 1.999999.0 < 2.0.0 → should NOT precede → appended after band
			expect(slot).toEqual({ mode: "after", line: 3 });
		});
		it("tolerates a 'v' prefix and trailing codename", () => {
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## v2.0.0 — codename",
				2,
				ob({ by: "semver", direction: "desc" }),
			);
			expect(slot).toEqual({ mode: "before", line: 2 });
		});

		it("parses the Keep a Changelog bracketed format '## [x.y.z] - date'", () => {
			const kac = ["# Changelog", "", "## [1.9.0] - 2026-01-01", "- old fix"];
			const slot = computeOrderedSectionInsertIndex(
				kac,
				"## [1.10.0] - 2026-06-16",
				2,
				ob({ by: "semver", direction: "desc" }),
			);
			// [1.10.0] > [1.9.0] → placed above, not appended below as unparseable.
			expect(slot).toEqual({ mode: "before", line: 2 });
		});
	});

	describe("unparseable keys", () => {
		it("an unparseable NEW key is appended at band end (desc)", () => {
			const lines = ["# C", "", "## 2.0.0", "- a", "", "## 1.0.0", "- b"];
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## Unreleased",
				2,
				ob({ by: "semver", direction: "desc" }),
			);
			expect(slot).toEqual({ mode: "after", line: 6 });
		});
		it("an unparseable NEW key is appended at band end (asc too)", () => {
			const lines = ["# C", "", "## 1.0.0", "- a"];
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## Unreleased",
				2,
				ob({ by: "semver", direction: "asc" }),
			);
			expect(slot).toEqual({ mode: "after", line: 3 });
		});
		it("existing unparseable sibling sinks to bottom (new parsed key precedes it)", () => {
			const lines = ["# C", "", "## Draft", "- a", "", "## 1.0.0", "- b"];
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 2.0.0",
				2,
				ob({ by: "semver", direction: "desc", unparseable: "bottom" }),
			);
			// "Draft" sinks → new parsed key should precede it
			expect(slot).toEqual({ mode: "before", line: 2 });
		});
		it("existing unparseable sibling pinned to top (new parsed key does not precede it)", () => {
			const lines = ["# C", "", "## Draft", "- a", "", "## 1.0.0", "- b"];
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 2.0.0",
				2,
				ob({ by: "semver", direction: "desc", unparseable: "top" }),
			);
			// "Draft" pinned top → new key does NOT precede it; precedes 1.0.0 instead
			expect(slot).toEqual({ mode: "before", line: 5 });
		});
	});

	describe("ties", () => {
		it("a distinct-but-equal key appends adjacent (stable)", () => {
			const lines = ["# C", "", "## 1.2.0", "- a"];
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 1.2.0-rc1",
				2,
				ob({ by: "semver", direction: "desc" }),
			);
			// compares equal → not precede → appended after band
			expect(slot).toEqual({ mode: "after", line: 3 });
		});
	});

	describe("level scoping & structure", () => {
		it("ignores headings of other levels (## never sorts against ### / #)", () => {
			const lines = [
				"# Log",
				"",
				"## 2026-06-14",
				"### sub of the 14th",
				"- nested",
				"",
				"## 2026-06-10",
				"- older",
			];
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 2026-06-16",
				2,
				ob({ by: "date", dateFormat: "YYYY-MM-DD", direction: "desc" }),
				makeFakeMoment(),
			);
			expect(slot).toEqual({ mode: "before", line: 2 }); // before "## 2026-06-14"
		});

		it("band-end append clears a last sibling's ### subsection", () => {
			const lines = [
				"# Log",
				"",
				"## 2026-06-14",
				"- entry",
				"### detail",
				"- nested",
			];
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 2026-06-10",
				2,
				ob({ by: "date", dateFormat: "YYYY-MM-DD", direction: "desc" }),
				makeFakeMoment(),
			);
			// older date appends AFTER the whole 06-14 section (incl. its ### subsection)
			expect(slot).toEqual({ mode: "after", line: 5 });
		});
	});

	describe("frontmatter exclusion (bodyStartLine)", () => {
		// "---\n# fm comment\ntags: x\n---\n# Title\nblurb\n" → body starts at line 4.
		const lines = [
			"---",
			"# fm comment",
			"tags: x",
			"---",
			"# Title",
			"blurb",
		];

		it("ignores a frontmatter '#' line as an H1 ancestor", () => {
			// H2 section, no body siblings, real ancestor is "# Title" (line 4) — NOT
			// the frontmatter "# fm comment" (line 1).
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 2026",
				2,
				ob({ by: "insertion", direction: "desc" }),
				undefined,
				4,
			);
			expect(slot).toEqual({ mode: "after", line: 5 }); // after "blurb"
		});

		it("never selects a frontmatter '#' line as an H1 sibling", () => {
			// H1 section: the only body H1 is "# Title" (line 4); the frontmatter
			// "# fm comment" must not be a sibling, else we'd splice into the YAML.
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"# 2026",
				1,
				ob({ by: "insertion", direction: "desc" }),
				undefined,
				4,
			);
			expect(slot).toEqual({ mode: "before", line: 4 }); // before "# Title", below the frontmatter
		});
	});

	describe("fenced code blocks", () => {
		it("does not treat a ## inside a code fence as a sibling", () => {
			const lines = [
				"# Log",
				"",
				"## 2026-06-14",
				"```md",
				"## 2026-12-31 (this is example text, not a heading)",
				"```",
				"- entry",
			];
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 2026-06-16",
				2,
				ob({ by: "date", dateFormat: "YYYY-MM-DD", direction: "desc" }),
				makeFakeMoment(),
			);
			// Only "## 2026-06-14" is a real sibling; newest goes before it.
			expect(slot).toEqual({ mode: "before", line: 2 });
		});

		it("appends after a last section whose body contains a fenced ## (not split)", () => {
			const lines = [
				"# Log",
				"",
				"## 2026-06-14",
				"- entry",
				"```md",
				"## not a heading",
				"```",
			];
			const slot = computeOrderedSectionInsertIndex(
				lines,
				"## 2026-06-10",
				2,
				ob({ by: "date", dateFormat: "YYYY-MM-DD", direction: "desc" }),
				makeFakeMoment(),
			);
			// older date appends after the whole 06-14 section incl. the code block
			expect(slot).toEqual({ mode: "after", line: 6 });
		});
	});
});
