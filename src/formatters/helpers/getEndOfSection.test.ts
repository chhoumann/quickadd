import { test, expect } from "vitest";
import getEndOfSection from "./getEndOfSection";

test("getEndOfSection - find the end of a section", () => {
	const headings = [
		{ level: 1, line: 1 },
		{ level: 2, line: 3 },
		{ level: 2, line: 6 },
		{ level: 1, line: 9 },
	];
	const lines = [
		"# Title",
		"",
		"## Section 1",
		"Content 1",
		"",
		"## Section 2",
		"Content 2",
		"",
		"# Title 2",
	];
	const targetLine = 3;

	const result = getEndOfSection(headings, lines, targetLine);
	expect(result).toBe(4);
});

test("getEndOfSection - find the end of the last section", () => {
	const headings = [
		{ level: 1, line: 1 },
		{ level: 2, line: 3 },
		{ level: 2, line: 6 },
		{ level: 1, line: 9 },
	];
	const lines = [
		"# Title",
		"",
		"## Section 1",
		"Content 1",
		"",
		"## Section 2",
		"Content 2",
		"",
		"# Title 2",
	];
	const targetLine = 9;

	const result = getEndOfSection(headings, lines, targetLine);
	expect(result).toBe(8);
});

test("getEndOfSection - no target section", () => {
	const headings = [
		{ level: 1, line: 1 },
		{ level: 2, line: 3 },
		{ level: 2, line: 6 },
		{ level: 1, line: 9 },
	];
	const lines = [
		"# Title",
		"",
		"## Section 1",
		"Content 1",
		"",
		"## Section 2",
		"Content 2",
		"",
		"# Title 2",
	];
	const targetLine = 100;

	const result = getEndOfSection(headings, lines, targetLine);
	expect(result).toBe(8);
});

test("getEndOfSection - find end of section with multiple empty lines", () => {
	const headings = [
		{ level: 1, line: 1 },
		{ level: 2, line: 3 },
		{ level: 2, line: 6 },
		{ level: 1, line: 9 },
	];
	const lines = [
		"# Title",
		"",
		"## Section 1",
		"Content 1",
		"",
		"",
		"## Section 2",
		"Content 2",
		"",
		"# Title 2",
	];
	const targetLine = 3;

	const result = getEndOfSection(headings, lines, targetLine);
	expect(result).toBe(4);
});

test("getEndOfSection - find end of section without a higher level section", () => {
	const headings = [
		{ level: 1, line: 1 },
		{ level: 2, line: 3 },
		{ level: 2, line: 6 },
		{ level: 2, line: 9 },
	];
	const lines = [
		"# Title",
		"",
		"## Section 1",
		"Content 1",
		"",
		"## Section 2",
		"Content 2",
		"",
		"## Section 3",
		"Content 3",
	];
	const targetLine = 3;

	const result = getEndOfSection(headings, lines, targetLine);
	expect(result).toBe(4);
});

test("getEndOfSection - find end of section with higher level section", () => {
	const headings = [
		{ level: 1, line: 1 },
		{ level: 2, line: 3 },
		{ level: 2, line: 6 },
		{ level: 1, line: 9 },
	];
	const lines = [
		"# Title",
		"",
		"## Section 1",
		"Content 1",
		"",
		"## Section 2",
		"Content 2",
		"",
		"# Title 2",
		"Content 3",
	];
	const targetLine = 3;

	const result = getEndOfSection(headings, lines, targetLine);
	expect(result).toBe(4);
});

test("getEndOfSection - find end of section with no headings", () => {
	const lines = ["Content 1", "", "Content 2", "Content 3", "", "Content 4"];
	const targetLine = 1;

	const result = getEndOfSection([], lines, targetLine);
	expect(result).toBe(5);
});

test("getEndOfSection - find end of section with top level heading and only sub headings", () => {
	const lines = [
		"# Notes",
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
		"content b1",
		"",
		"",
	];
	const headings = [
		{
			level: 1,
			line: 0,
		},
		{
			level: 2,
			line: 2,
		},
		{
			level: 2,
			line: 13,
		},
	];

    const targetLine = 0;

    const result = getEndOfSection(headings, lines, targetLine);
    expect(result).toBe(15);
});
