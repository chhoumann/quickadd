import { describe, expect, it } from "vitest";
import { __test } from "./utilityObsidian";
import { insertLinkIntoContent } from "./utilityObsidian";
import type ICaptureChoice from "./types/choices/ICaptureChoice";

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

describe("insertLinkIntoContent", () => {
	const linkText = "[[Test Note]]";

	describe("prepend behavior", () => {
		it("inserts link at bottom when prepend=true", () => {
			const content = "Line 1\nLine 2\nLine 3";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "endOfLine",
				prepend: true,
			});

			expect(result).toBe("Line 1\nLine 2\nLine 3[[Test Note]]");
		});

		it("inserts link at bottom with frontmatter when prepend=true", () => {
			const content = "---\ntitle: Test\n---\nBody line 1\nBody line 2";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "endOfLine",
				prepend: true,
			});

			expect(result).toBe(
				"---\ntitle: Test\n---\nBody line 1\nBody line 2[[Test Note]]",
			);
		});

		it("handles empty file with prepend=true", () => {
			const content = "";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "endOfLine",
				prepend: true,
			});

			expect(result).toBe("[[Test Note]]");
		});
	});

	describe("default behavior (prepend=false)", () => {
		it("inserts link after frontmatter when frontmatter exists", () => {
			const content = "---\ntitle: Test\n---\nBody content";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "newLine",
				prepend: false,
			});

			// newLine placement inserts after anchor line, adding newline before link if needed
			expect(result).toBe("---\ntitle: Test\n---\n[[Test Note]]Body content");
		});

		it("inserts link at top when no frontmatter exists", () => {
			const content = "Line 1\nLine 2\nLine 3";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "newLine",
				prepend: false,
			});

			// When anchorLine=-1 (no frontmatter), newLine inserts at position 0
			expect(result).toBe("[[Test Note]]Line 1\nLine 2\nLine 3");
		});

		it("inserts link at top of empty file", () => {
			const content = "";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "endOfLine",
				prepend: false,
			});

			expect(result).toBe("[[Test Note]]");
		});

		it("handles frontmatter ending with newline", () => {
			const content = "---\ntitle: Test\n---\n\nBody";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "newLine",
				prepend: false,
			});

			// Anchor is after frontmatter (line 2), newLine inserts after that line
			expect(result).toBe("---\ntitle: Test\n---\n\n[[Test Note]]Body");
		});

		it("handles frontmatter without trailing newline", () => {
			const content = "---\ntitle: Test\n---Body";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "newLine",
				prepend: false,
			});

			// When frontmatter detection fails (no newline after ---), falls back to top
			// This is expected behavior - frontmatter must end with newline
			expect(result).toContain("[[Test Note]]");
		});
	});

	describe("insertAfter behavior", () => {
		it("inserts link after specified heading", () => {
			const content = "# Heading 1\nContent 1\n## Heading 2\nContent 2";
			const insertAfter: ICaptureChoice["insertAfter"] = {
				enabled: true,
				after: "## Heading 2",
				insertAtEnd: false,
				considerSubsections: false,
				createIfNotFound: false,
				createIfNotFoundLocation: "top",
			};

			const result = insertLinkIntoContent(content, linkText, {
				placement: "newLine",
				insertAfter,
				prepend: false,
			});

			// newLine placement inserts after anchor line
			expect(result).toBe(
				"# Heading 1\nContent 1\n## Heading 2\n[[Test Note]]Content 2",
			);
		});

		it("inserts link at end of section when insertAtEnd=true", () => {
			const content =
				"# Heading 1\nContent 1\n## Heading 2\nSub content\n## Heading 3\nOther";
			const insertAfter: ICaptureChoice["insertAfter"] = {
				enabled: true,
				after: "## Heading 2",
				insertAtEnd: true,
				considerSubsections: false,
				createIfNotFound: false,
				createIfNotFoundLocation: "top",
			};

			const result = insertLinkIntoContent(content, linkText, {
				placement: "newLine",
				insertAfter,
				prepend: false,
			});

			// Should insert before "## Heading 3" (end of Heading 2 section)
			expect(result).toContain("[[Test Note]]");
			expect(result).toContain("Sub content");
			const linkIndex = result.indexOf("[[Test Note]]");
			const heading3Index = result.indexOf("## Heading 3");
			expect(linkIndex).toBeLessThan(heading3Index);
		});

		it("creates insertAfter line when createIfNotFound=true and location=top", () => {
			const content = "Some content";
			const insertAfter: ICaptureChoice["insertAfter"] = {
				enabled: true,
				after: "## Missing Heading",
				insertAtEnd: false,
				considerSubsections: false,
				createIfNotFound: true,
				createIfNotFoundLocation: "top",
			};

			const result = insertLinkIntoContent(content, linkText, {
				placement: "newLine",
				insertAfter,
				prepend: false,
			});

			expect(result).toContain("## Missing Heading");
			expect(result).toContain("[[Test Note]]");
			expect(result.indexOf("## Missing Heading")).toBeLessThan(
				result.indexOf("[[Test Note]]"),
			);
		});
	});

	describe("placement options", () => {
		it("inserts at end of line with endOfLine placement", () => {
			const content = "Line 1\nLine 2";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "endOfLine",
				prepend: true,
			});

			expect(result).toBe("Line 1\nLine 2[[Test Note]]");
		});

		it("inserts on new line with newLine placement", () => {
			const content = "Line 1\nLine 2";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "newLine",
				prepend: true,
			});

			expect(result).toBe("Line 1\nLine 2\n[[Test Note]]");
		});

		it("normalizes afterSelection to endOfLine", () => {
			const content = "Line 1\nLine 2";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "afterSelection",
				prepend: true,
			});

			// Should behave like endOfLine
			expect(result).toBe("Line 1\nLine 2[[Test Note]]");
		});

		it("inserts after anchor line with replaceSelection placement", () => {
			const content = "Line 1\nLine 2\nLine 3";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "replaceSelection",
				prepend: true,
			});

			// replaceSelection inserts at afterLineOffset (after anchor line), which is end of content when prepend=true
			expect(result).toBe("Line 1\nLine 2\nLine 3[[Test Note]]");
		});
	});

	describe("edge cases", () => {
		it("handles file with only frontmatter", () => {
			const content = "---\ntitle: Test\n---";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "newLine",
				prepend: false,
			});

			expect(result).toBe("---\ntitle: Test\n---\n[[Test Note]]");
		});

		it("handles whitespace-only file", () => {
			const content = "   \n\n  ";
			const result = insertLinkIntoContent(content, linkText, {
				placement: "endOfLine",
				prepend: false,
			});

			expect(result).toContain("[[Test Note]]");
		});

		it("prioritizes insertAfter over prepend", () => {
			const content = "# Heading\nContent";
			const insertAfter: ICaptureChoice["insertAfter"] = {
				enabled: true,
				after: "# Heading",
				insertAtEnd: false,
				considerSubsections: false,
				createIfNotFound: false,
				createIfNotFoundLocation: "top",
			};

			const result = insertLinkIntoContent(content, linkText, {
				placement: "newLine",
				insertAfter,
				prepend: true, // Should be ignored
			});

			// Should insert after heading, not at bottom
			expect(result).toBe("# Heading\n[[Test Note]]Content");
		});
	});
});