import { test, expect } from "vitest";
import getEndOfSection from "./getEndOfSection";

test("getEndOfSection - find the end of a section", () => {
	const lines = [
		"# Title",
		"",
		"## Section 1", // target (2)
		"Content 1",
		"", // result (4)
		"## Section 2",
		"Content 2",
		"",
		"# Title 2",
	];
	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine);
	expect(result).toBe(4);
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
		"# Title 2", // target (8)
		"", // result (9)
	];
	const targetLine = 8;

	const result = getEndOfSection(lines, targetLine);
	expect(result).toBe(9);
});

test("getEndOfSection - find end of section with multiple empty lines", () => {
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
	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine);
	expect(result).toBe(4);
});

test("getEndOfSection - find end of section without a higher level section", () => {
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
	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine);
	expect(result).toBe(4);
});

test("getEndOfSection - find end of section with higher level section", () => {
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
	const targetLine = 0;

	const result = getEndOfSection(lines, targetLine);
	expect(result).toBe(7);
});

test("getEndOfSection - find end of section with no headings", () => {
	const lines = ["Content 1", "", "Content 2", "Content 3", "", "Content 4"];
	const targetLine = 2;

	const result = getEndOfSection(lines, targetLine);
	expect(result).toBe(4);
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
		"content b1",
		"", // result (15)
		"",
	];

	const targetLine = 0;

	const result = getEndOfSection(lines, targetLine);
	expect(result).toBe(15);
});

test("getEndOfSection - target isn't heading", () => {
	const lines = [
		"# Notes",
		"",
		"## Topic A",
		"content a1", // target (3)
		"content a2",
		"content a3",
		"", // result (6)
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

	const result = getEndOfSection(lines, targetLine);
	expect(result).toBe(6);
});
