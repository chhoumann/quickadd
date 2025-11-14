import { describe, expect, it } from "vitest";
import { __test } from "./utilityObsidian";

const { convertLinkToEmbed, extractMarkdownLinkTarget } = __test;

describe("convertLinkToEmbed", () => {
	it("converts wiki links to embeds", () => {
		expect(convertLinkToEmbed("[[Note]]")).toBe("![[Note]]");
	});

	it("leaves already embedded wiki links unchanged", () => {
		expect(convertLinkToEmbed("![[Note]]")).toBe("![[Note]]");
	});

	it("converts markdown links into wiki embeds", () => {
		expect(convertLinkToEmbed("[Title](../Note.md)")).toBe("![[../Note.md]]");
	});

	it("preserves markdown heading targets when embedding", () => {
		expect(convertLinkToEmbed("[Title](Note.md#Heading)")).toBe("![[Note.md#Heading]]");
	});

	it("strips surrounding angle brackets before embedding", () => {
		expect(convertLinkToEmbed("[Title](<path/to/note.md>)")).toBe("![[path/to/note.md]]");
	});

	it("converts plain text references by prefixing a bang", () => {
		expect(convertLinkToEmbed("Note")).toBe("!Note");
	});

	it("prefixes malformed markdown links so they still embed", () => {
		expect(convertLinkToEmbed("[Title](Note.md")).toBe("![Title](Note.md");
	});

	it("trims whitespace around markdown links before conversion", () => {
		const link = "   [Label](../Another Note.md#Heading)   ";
		expect(convertLinkToEmbed(link)).toBe("![[../Another Note.md#Heading]]");
	});
});

describe("extractMarkdownLinkTarget", () => {
	it("extracts targets from standard markdown links", () => {
		expect(extractMarkdownLinkTarget("[Label](Note.md)")).toBe("Note.md");
	});

	it("handles image-style markdown links", () => {
		expect(extractMarkdownLinkTarget("![Label](Note.md)")).toBe("Note.md");
	});

	it("includes heading fragments when present", () => {
		expect(extractMarkdownLinkTarget("[Label](Note.md#Heading)")).toBe("Note.md#Heading");
	});

	it("removes surrounding angle brackets", () => {
		expect(extractMarkdownLinkTarget("[Label](<Note.md>)")).toBe("Note.md");
	});

	it("trims whitespace inside parentheses", () => {
		expect(extractMarkdownLinkTarget("[Label](   Note.md  )")).toBe("Note.md");
	});

	it("returns null for wiki links", () => {
		expect(extractMarkdownLinkTarget("[[Note]]")).toBeNull();
	});

	it("returns null for malformed markdown", () => {
		expect(extractMarkdownLinkTarget("[Label](Note.md")).toBeNull();
	});

	it("returns null for empty targets", () => {
		expect(extractMarkdownLinkTarget("[Label]()")).toBeNull();
	});
});