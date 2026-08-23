import { describe, expect, it } from "vitest";
import { previewSelection, replaceRange } from "./peekText";

describe("replaceRange", () => {
	it("inserts at a collapsed caret and advances it", () => {
		expect(replaceRange("Hello ", 6, 6, "world")).toEqual({
			text: "Hello world",
			cursor: 11,
		});
	});

	it("replaces the selected range", () => {
		expect(replaceRange("old draft", 0, 9, "fresh")).toEqual({
			text: "fresh",
			cursor: 5,
		});
	});

	it("clamps positions past the end", () => {
		expect(replaceRange("ab", 99, 120, "c")).toEqual({
			text: "abc",
			cursor: 3,
		});
	});
});

describe("previewSelection", () => {
	it("collapses whitespace and ellipsizes", () => {
		expect(previewSelection("alpha   beta\ngamma", 11)).toBe("alpha beta…");
	});

	it("returns short selections untouched", () => {
		expect(previewSelection("just this")).toBe("just this");
	});

	it("marks truncation even when the windowed text collapses short", () => {
		const airy = `a${" ".repeat(60)}b${" ".repeat(60)}c`.repeat(4);
		const preview = previewSelection(airy, 10);
		expect(preview.endsWith("…")).toBe(true);
	});
});
