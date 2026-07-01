import { describe, it, expect } from "vitest";
import {
	toTargetLines,
	isBlankTarget,
	findSingleLineIndex,
	findMultiLineRange,
	findInsertAfterRange,
	isAtxHeading,
	shouldSkipBlankLinesAfterMatch,
	findInsertAfterPositionWithBlankLines,
	findInsertAfterPositionAtSectionEnd,
	hasInlineTargetLinebreak,
	getInlineEndOfLine,
	getBodyStartLine,
	maskNonBodyHeadingsForSearch,
	anchorAllowsSubsections,
	insertTextAfterPositionInBody,
	insertTextBeforePositionInBody,
	spliceOrderedSection,
} from "./insertionPositioning";

describe("toTargetLines", () => {
	it("drops trailing blank lines from a trailing \\n escape", () => {
		expect(toTargetLines("**Today**\n")).toEqual(["**Today**"]);
		expect(toTargetLines("**Today**\n\n")).toEqual(["**Today**"]);
	});
	it("preserves interior blank lines", () => {
		expect(toTargetLines("## D\n\n**Tasks**")).toEqual(["## D", "", "**Tasks**"]);
	});
	it("returns a single-element array for a plain target", () => {
		expect(toTargetLines("## Log")).toEqual(["## Log"]);
	});
});

describe("isBlankTarget", () => {
	it("is true for empty / single-blank targets", () => {
		expect(isBlankTarget([])).toBe(true);
		expect(isBlankTarget([""])).toBe(true);
		expect(isBlankTarget(["   "])).toBe(true);
	});
	it("is false for real content", () => {
		expect(isBlankTarget(["## Log"])).toBe(false);
		expect(isBlankTarget(["", "x"])).toBe(false);
	});
});

describe("findSingleLineIndex", () => {
	const lines = ["# Title", "  ## Log", "- a", "before | ----- |"];
	it("matches exact (ignoring leading whitespace)", () => {
		expect(findSingleLineIndex(lines, "## Log")).toBe(1);
	});
	it("matches a substring with only-whitespace suffix", () => {
		expect(findSingleLineIndex(["text TARGET   "], "TARGET")).toBe(0);
	});
	it("returns -1 when no match", () => {
		expect(findSingleLineIndex(lines, "## Missing")).toBe(-1);
	});
});

describe("findMultiLineRange", () => {
	it("matches a consecutive run, normalizing trailing whitespace/CR", () => {
		const lines = ["a", "## D\r", "**Tasks**  ", "b"];
		expect(findMultiLineRange(lines, ["## D", "**Tasks**"])).toEqual({
			start: 1,
			end: 2,
		});
	});
	it("does not match when leading indentation differs", () => {
		const lines = ["- Parent", "- Child"];
		expect(findMultiLineRange(lines, ["  - Parent", "    - Child"])).toEqual({
			start: -1,
			end: -1,
		});
	});

	// The old stripTrailingWhitespace used /\s+$/, which backtracks
	// quadratically on a line holding a long interior whitespace run
	// (" ".repeat(n) + "x"): ~3.2s at n=80k, frozen UI during a multi-line
	// insert-after capture over an untrusted (synced/pasted/AI-written) note.
	// trimEnd() is linear; the budget is generous to stay non-flaky while
	// failing hard on any quadratic regression.
	it("normalizes a pathological whitespace-run line in linear time", () => {
		const lines = [" ".repeat(200_000) + "x", "## D", "**Tasks**"];
		const start = performance.now();
		expect(findMultiLineRange(lines, ["## D", "**Tasks**"])).toEqual({
			start: 1,
			end: 2,
		});
		expect(performance.now() - start).toBeLessThan(1000);
	}, 20_000);
});

describe("findInsertAfterRange", () => {
	it("delegates to single-line search for a one-line target", () => {
		expect(findInsertAfterRange(["x", "## Log"], ["## Log"])).toEqual({
			start: 1,
			end: 1,
		});
	});
	it("delegates to multi-line search for a multi-line target", () => {
		expect(
			findInsertAfterRange(["## D", "**Tasks**", "y"], ["## D", "**Tasks**"]),
		).toEqual({ start: 0, end: 1 });
	});
});

describe("isAtxHeading / shouldSkipBlankLinesAfterMatch", () => {
	it("recognizes ATX headings", () => {
		expect(isAtxHeading("## Log")).toBe(true);
		expect(isAtxHeading("not a heading")).toBe(false);
	});
	it("auto mode only skips after a heading", () => {
		expect(shouldSkipBlankLinesAfterMatch("auto", "## Log")).toBe(true);
		expect(shouldSkipBlankLinesAfterMatch("auto", "- item")).toBe(false);
		expect(shouldSkipBlankLinesAfterMatch("skip", "- item")).toBe(true);
		expect(shouldSkipBlankLinesAfterMatch("none", "## Log")).toBe(false);
	});
});

describe("findInsertAfterPositionWithBlankLines", () => {
	it("skips trailing blank lines after a heading in auto mode", () => {
		const body = "## Log\n\n\n- existing";
		const lines = body.split("\n");
		// matchIndex 0 (the heading), should advance past the two blanks to line 2
		expect(findInsertAfterPositionWithBlankLines(lines, 0, body, "auto")).toBe(2);
	});
	it("returns the match index when not a heading (auto)", () => {
		const body = "- item\n\n- next";
		expect(
			findInsertAfterPositionWithBlankLines(body.split("\n"), 0, body, "auto"),
		).toBe(0);
	});
});

describe("findInsertAfterPositionAtSectionEnd", () => {
	it("advances past trailing blanks but keeps one slot when content ends with a newline", () => {
		const file = "## A\n- x\n\n";
		const lines = file.split("\n"); // ["## A","- x","",""]
		// sectionEnd at 1, two trailing blank slots, inserted text ends with \n:
		// advance to the last blank (3) then keep one slot back -> 2.
		expect(
			findInsertAfterPositionAtSectionEnd(lines, 1, file, "- new\n"),
		).toBe(2);
	});
	it("stays at the section end when there are no trailing blanks", () => {
		const file = "## A\n- x\n## B\n";
		const lines = file.split("\n");
		expect(findInsertAfterPositionAtSectionEnd(lines, 1, file, "- new\n")).toBe(1);
	});
});

describe("hasInlineTargetLinebreak", () => {
	it("detects LF and CR in a target", () => {
		expect(hasInlineTargetLinebreak("a\nb")).toBe(true);
		expect(hasInlineTargetLinebreak("a\rb")).toBe(true);
		expect(hasInlineTargetLinebreak("single line")).toBe(false);
	});
});

describe("getInlineEndOfLine", () => {
	it("returns the LF index", () => {
		expect(getInlineEndOfLine("abc\ndef", 0)).toBe(3);
	});
	it("returns before the CR for CRLF", () => {
		expect(getInlineEndOfLine("abc\r\ndef", 0)).toBe(3);
	});
	it("returns content length when no newline", () => {
		expect(getInlineEndOfLine("abc", 0)).toBe(3);
	});
});

describe("getBodyStartLine", () => {
	it("is 0 when there is no frontmatter", () => {
		expect(getBodyStartLine("# Title\nbody")).toBe(0);
	});
	it("points past a YAML frontmatter block", () => {
		const file = "---\ntitle: x\n---\n## Log";
		// line 3 is the first body line after the closing ---
		expect(getBodyStartLine(file)).toBe(3);
	});
});

describe("maskNonBodyHeadingsForSearch", () => {
	it("blanks frontmatter lines and masks fenced-code headings, preserving indices", () => {
		const file = "---\na: 1\n---\n## Real\n```\n## Fake\n```";
		const lines = file.split("\n");
		const masked = maskNonBodyHeadingsForSearch(lines, file);
		expect(masked.length).toBe(lines.length);
		expect(masked[0]).toBe(""); // frontmatter blanked
		expect(masked[3]).toBe("## Real"); // real heading kept
		expect(masked[5]).not.toBe("## Fake"); // fenced heading neutralized
	});

	it("does not mask a real body heading when frontmatter holds an unclosed code fence (CodeRabbit #1404)", () => {
		// A YAML block scalar containing an indented code fence: maskFencedHeadings
		// must run on body-scoped lines, otherwise the unclosed frontmatter fence
		// leaks into the body and neutralizes the real heading.
		const file = "---\nnote: |\n  ```js\n  example\n---\n## Real\n- x";
		const lines = file.split("\n");
		const realIdx = lines.indexOf("## Real");
		const masked = maskNonBodyHeadingsForSearch(lines, file);
		expect(masked[realIdx]).toBe("## Real");
	});
});

describe("anchorAllowsSubsections", () => {
	it("is false when the flag is off", () => {
		expect(anchorAllowsSubsections(false, ["## H"], 0)).toBe(false);
	});
	it("is true only for a heading anchor when the flag is on", () => {
		expect(anchorAllowsSubsections(true, ["## H"], 0)).toBe(true);
		expect(anchorAllowsSubsections(true, ["- item"], 0)).toBe(false);
	});
});

describe("insertTextAfterPositionInBody", () => {
	it("splices after the given line and reports the end offset", () => {
		const body = "a\nb\nc";
		const r = insertTextAfterPositionInBody("X\n", body, 0, false);
		expect(r.content).toBe("a\nX\nb\nc");
		expect(r.insertedEndOffset).toBe("a\n".length + "X\n".length);
	});
	it("drops QuickAdd's injected task newline when a blank line is directly below (#312)", () => {
		const body = "## Log\n\n- after";
		// insert after heading (pos 0); line below (1) is blank -> the injected
		// task newline is dropped, collapsing the doubled blank.
		const r = insertTextAfterPositionInBody("- task\n", body, 0, true);
		expect(r.content).toBe("## Log\n- task\n- after");
	});
	it("keeps the trailing newline when not a task (one blank preserved)", () => {
		const body = "## Log\n\n- after";
		const r = insertTextAfterPositionInBody("- x\n", body, 0, false);
		expect(r.content).toBe("## Log\n- x\n\n- after");
	});
});

describe("insertTextBeforePositionInBody", () => {
	it("prepends when pos <= 0", () => {
		const r = insertTextBeforePositionInBody("X", "body", 0);
		expect(r.content).toBe("X\nbody");
	});
	it("splices before a mid-file line", () => {
		const r = insertTextBeforePositionInBody("X", "a\nb\nc", 1);
		expect(r.content).toBe("a\nX\nb\nc");
	});
});

describe("spliceOrderedSection", () => {
	it("inserts before a slot line with blank-line padding", () => {
		const file = "## 2026-06-16\n- a\n## 2026-06-14\n- c\n";
		const rawLines = file.split("\n");
		const r = spliceOrderedSection(
			rawLines,
			{ mode: "before", line: 2 },
			"## 2026-06-15\n- b",
			file,
		);
		expect(r.content).toBe(
			"## 2026-06-16\n- a\n\n## 2026-06-15\n- b\n\n## 2026-06-14\n- c\n",
		);
		expect(r.insertedEndOffset).toBeGreaterThan(0);
	});
	it("preserves CRLF as the dominant EOL", () => {
		const file = "## A\r\n- a\r\n";
		const rawLines = file.split("\n"); // ["## A\r","- a\r",""]
		const r = spliceOrderedSection(
			rawLines,
			{ mode: "after", line: 1 },
			"## B\n- b",
			file,
		);
		expect(r.content).toContain("\r\n## B\r\n- b");
	});
});
