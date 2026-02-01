import { test, expect } from "vitest";
import getEndOfSection, { getMarkdownHeadings } from "./getEndOfSection";

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


test("getMarkdownHeadings - correctly identifies headings", () => {
	const lines = [
		"# Heading 1",
		"## Heading 2",
		"### Heading 3",
		"#### Heading 4",
		"##### Heading 5",
		"###### Heading 6",
		"Normal text",
		"#Not a heading",
		"# Heading with #hash in text",
		"##Invalid heading",
		"",
		"  # Heading with leading spaces",
	];

	const result = getMarkdownHeadings(lines);

	expect(result).toEqual([
		{ level: 1, text: "Heading 1", line: 0 },
		{ level: 2, text: "Heading 2", line: 1 },
		{ level: 3, text: "Heading 3", line: 2 },
		{ level: 4, text: "Heading 4", line: 3 },
		{ level: 5, text: "Heading 5", line: 4 },
		{ level: 6, text: "Heading 6", line: 5 },
		{ level: 1, text: "Heading with #hash in text", line: 8 },
	]);
});

test("getMarkdownHeadings - handles empty input", () => {
	const lines: string[] = [];

	const result = getMarkdownHeadings(lines);

	expect(result).toEqual([]);
});

test("getMarkdownHeadings - correctly ignores Obsidian tags", () => {
	const lines = [
		"# Real Heading",
		"#tag",
		"#anothertag",
		"Text with #inline_tag",
		"## Heading with #tag in it",
	];

	const result = getMarkdownHeadings(lines);

	expect(result).toEqual([
		{ level: 1, text: "Real Heading", line: 0 },
		{ level: 2, text: "Heading with #tag in it", line: 4 },
	]);
});
