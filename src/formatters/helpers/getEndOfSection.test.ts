import { test, expect } from "vitest";
import getEndOfSection from "./getEndOfSection";

test("getEndOfSection - find the end of a section", () => {
	const lines = [
		"# Title",
		"",
		"## Section 1", // target (2)
		"Content 1", // result (3)
		"",
		"## Section 2",
		"Content 2",
		"",
		"# Title 2",
	];
	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine, true);
	expect(result).toBe(3);
});

test("getEndOfSection - find the end of the last section", () => {
	const lines = [
		"# Title",
		"",
		"## Section 1",
		"Content 1",
		"",
		"## Section 2",
		"Content 2",
		"",
		"# Title 2", // target (8) & result (8)
		"",
	];
	const targetLine = 8;

	const result = getEndOfSection(lines, targetLine, true);
	expect(result).toBe(8);
});

test("getEndOfSection - find end of section with multiple empty lines", () => {
	const lines = [
		"# Title",
		"",
		"## Section 1", // target (2)
		"Content 1", // result (4)
		"",
		"",
		"## Section 2",
		"Content 2",
		"",
		"# Title 2",
	];
	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine, true);
	expect(result).toBe(3);
});

test("getEndOfSection - find end of section without a higher level section", () => {
	const lines = [
		"# Title",
		"",
		"## Section 1", // target (2)
		"Content 1", // result (3)
		"",
		"## Section 2",
		"Content 2",
		"",
		"## Section 3",
		"Content 3",
	];
	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine, true);
	expect(result).toBe(3);
});

test("getEndOfSection - find end of section with higher level section", () => {
	const lines = [
		"# Title", // target (0)
		"",
		"## Section 1",
		"Content 1",
		"",
		"## Section 2",
		"Content 2", // result (6)
		"",
		"# Title 2",
		"Content 3",
	];
	const targetLine = 0;

	const result = getEndOfSection(lines, targetLine, true);
	expect(result).toBe(6);
});

test("getEndOfSection - find end of section with no headings", () => {
	const lines = [
		"Content 1",
		"",
		"Content 2", // target (2)
		"Content 3", // result (3)
		"",
		"Content 4",
	];
	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine);
	expect(result).toBe(3);
});

test("getEndOfSection - find end of section with top level heading and only sub headings", () => {
	const lines = [
		"# Notes", // target (0)
		"",
		"## Topic A",
		"content a1",
		"content a2",
		"content a3",
		"",
		"---",
		"Thematic break",
		"1",
		"2",
		"3",
		"",
		"## Topic B",
		"content b1", // result (14)
		"",
		"",
	];

	const targetLine = 0;

	const result = getEndOfSection(lines, targetLine, true);
	expect(result).toBe(14);
});

test("getEndOfSection - target isn't heading", () => {
	const lines = [
		"# Notes",
		"",
		"## Topic A",
		"content a1", // target (3)
		"content a2",
		"content a3", // result (5)
		"",
		"---",
		"Thematic break",
		"1",
		"2",
		"3",
		"",
		"## Topic B",
		"content b1",
		"",
		"",
	];

	const targetLine = 3;

	const result = getEndOfSection(lines, targetLine, false);
	expect(result).toBe(5);
});

test("getEndOfSection - target isn't heading, a heading ends the block before any blank line (#1926)", () => {
	const lines = [
		"> [!info]- Captured today", // target (0)
		"> one", // result (1)
		"## Journal",
		"- entry",
		"",
	];

	expect(getEndOfSection(lines, 0, false)).toBe(1);
});

test("getEndOfSection - target isn't heading, the block runs to the end of a note without a final line break (#1926)", () => {
	const lines = [
		"## Journal",
		"> [!info]- Captured today", // target (1)
		"> one", // result (2)
	];

	expect(getEndOfSection(lines, 1, false)).toBe(2);
});

test("getEndOfSection - target isn't heading, a # line inside a code fence doesn't end the block (#1926)", () => {
	const lines = [
		"Setup steps:", // target (0)
		"```bash",
		"# install deps",
		"pnpm install",
		"```", // result (4)
		"",
		"## Next",
	];

	expect(getEndOfSection(lines, 0, false)).toBe(4);
});

test("getEndOfSection - target is heading, should not consider subsections", () => {
	const lines = [
		"# Notes",
		"",
		"## Topic A", // target (2)
		"content a1",
		"content a2",
		"content a3", // result (5)
		"## Topic B",
		"content b1",
		"",
		"",
	];

	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine, false);
	expect(result).toBe(5);
});

test("getEndOfSection - capture to end of section with a leading tag, should not consider subsections", () => {
	const lines = [
		"# Notes",
		"",
		"## Topic A", // target (2)
		"content a1",
		"#TagForA1",
		"content a2", // result (5)
		"## Topic B",
		"content b1",
		"",
		"",
	];

	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine, false);
	expect(result).toBe(5);
});

test("getEndOfSection - heading section with markdown table separators", () => {
	const lines = [
		"# Notes",
		"",
		"## Time", // target (2)
		"| Price | Account | receiver | Name |",
		"| --- | --- | --- | --- |",
		"| 22 | boc | rstr | breakfast |",
		"| 45 | boc | rstr | lunch |", // result (6)
		"## Next",
		"content",
	];

	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine, false);
	expect(result).toBe(6);
});

test("getEndOfSection - target is heading, should consider subsections", () => {
	const lines = [
		"# Notes", // target (0)
		"",
		"## Topic A",
		"content a1",
		"## Topic B",
		"content b1",
		"### contentA",
		"content",
		"#### contentB",
		"content",
		"content", // target (10)
	];

	const targetLine = 0;

	const result = getEndOfSection(lines, targetLine, true);
	expect(result).toBe(10);
});

test("getEndOfSection - Capture to first line, shouldConsiderSubsections ON", () => {
	const lines = [
		"# Meeting Notes", // target (0)
		"",
		"### Topic A",
		"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer sit amet commodo mi, nec consequat tellus.",
		"",
		"### Topic B",
		"Aliquam erat volutpat. Nullam fringilla, enim eu volutpat congue, odio elit imperdiet felis, non congue est justo cursus dui.", // result (6)
	];

	const targetLine = 0;

	const result = getEndOfSection(lines, targetLine, true);
	expect(result).toBe(6);
});

test("getEndOfSection - Capture to first line, shouldConsiderSubsections OFF", () => {
	const lines = [
		"# Meeting Notes", // target (0)
		"", // result (1)
		"### Topic A",
		"Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer sit amet commodo mi, nec consequat tellus.",
		"",
		"### Topic B",
		"Aliquam erat volutpat. Nullam fringilla, enim eu volutpat congue, odio elit imperdiet felis, non congue est justo cursus dui.",
	];

	const targetLine = 0;

	const result = getEndOfSection(lines, targetLine, false);
	expect(result).toBe(1);
});

test("getEndOfSection - capture to last line, shouldConsiderSubsections OFF", () => {
	const lines = [
		"",
		"## Heading",
		"",
		"## Todos",
		"- [ ] test",
		"- [ ] asd",
		"- [ ] d",
		"",
		"## Schedule", // target (8) & result (8)
	];

	const targetLine = 8;

	const result = getEndOfSection(lines, targetLine, false);
	expect(result).toBe(8);
});

test("getEndOfSection - capture to last line, shouldConsiderSubsections ON", () => {
	const lines = [
		"",
		"## Heading",
		"",
		"## Todos",
		"- [ ] test",
		"- [ ] asd",
		"- [ ] d",
		"",
		"## Schedule", // target (8) & result (8)
	];

	const targetLine = 8;

	const result = getEndOfSection(lines, targetLine, true);
	expect(result).toBe(8);
});

test("getEndOfSection - capture to last line, shouldConsiderSubsections OFF", () => {
	const lines = [
		"",
		"",
		"## Delivered", // target (2) & result (2)
		"",
	];

	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine, false);
	expect(result).toBe(2);
});

test("getEndOfSection - target heading with only subsections, should not consider subsections", () => {
	const lines = [
		"## Insert", // target (0)
		"1",
		"2", // result (2)
		"### Subsection",
		"sub content",
	];

	const targetLine = 0;

	const result = getEndOfSection(lines, targetLine, false);
	expect(result).toBe(2);
});

test("getEndOfSection - an empty first section ends at its heading when the next heading follows at once", () => {
	expect(getEndOfSection(["## Log", "## Next"], 0, false)).toBe(0);
	// A setext heading spans two lines, so it starts on its text line.
	expect(getEndOfSection(["## Log", "Next", "---"], 0, false)).toBe(0);
});

test("getEndOfSection - a setext heading's section ends no earlier than its underline", () => {
	expect(
		getEndOfSection(["# Meetings", "", "Alpha", "---", "# Next", "body"], 2, true),
	).toBe(3);
	expect(getEndOfSection(["Alpha", "---", "## Next"], 0, false)).toBe(1);
});

test("getEndOfSection - considering subsections, a section's last line counts when the next heading follows at once (#2029)", () => {
	const lines = [
		"# Header one", // target (0)
		"## Pre-existing header",
		"Pre-existing text", // result (2)
		"# Header two",
		"",
	];
	expect(getEndOfSection(lines, 0, true)).toBe(2);
	// The same when the target heading isn't on the first line.
	expect(getEndOfSection(["intro", "# A", "text", "# B"], 1, true)).toBe(2);
	expect(getEndOfSection(["Alpha", "===", "text", "# B"], 0, true)).toBe(2);
});

test("getEndOfSection - the last section of a note without a final line break ends on its last paragraph", () => {
	const lines = ["# A", "text", "", "last"];
	expect(getEndOfSection(lines, 0, false)).toBe(3);
	expect(getEndOfSection(lines, 0, true)).toBe(3);
});
