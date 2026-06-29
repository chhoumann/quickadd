import { describe, it, expect } from "vitest";
import { InlineFieldParser } from "./InlineFieldParser";

describe("InlineFieldParser", () => {
	describe("parseInlineFields", () => {
		it("should parse simple inline field", () => {
			const content = "Some text\nstatus:: active\nMore text";
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.get("status")).toEqual(new Set(["active"]));
		});

		it("should parse multiple inline fields", () => {
			const content = `
Task description
status:: in-progress
priority:: high
assignee:: John Doe
			`;
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.get("status")).toEqual(new Set(["in-progress"]));
			expect(result.get("priority")).toEqual(new Set(["high"]));
			expect(result.get("assignee")).toEqual(new Set(["John Doe"]));
		});

		it("should parse comma-separated values", () => {
			const content = "tags:: work, project, urgent";
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.get("tags")).toEqual(
				new Set(["work", "project", "urgent"]),
			);
		});

		it("should keep a comma inside a wikilink attached to its link", () => {
			const content = "Related:: [[Note, with comma]]";
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.get("Related")).toEqual(
				new Set(["[[Note, with comma]]"]),
			);
		});

		it("should split a wikilink list while preserving inner commas", () => {
			const content =
				"Related:: [[Plain Note]], [[Another, with comma]]";
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.get("Related")).toEqual(
				new Set(["[[Plain Note]]", "[[Another, with comma]]"]),
			);
		});

		it("should handle multiple occurrences of same field", () => {
			const content = `
First note
type:: task
Second note
type:: meeting
Third note
type:: task
			`;
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.get("type")).toEqual(new Set(["task", "meeting"]));
		});

			it("should ignore fields in code blocks", () => {
				const content = `
Real field:: value1
\`\`\`
code:: should-be-ignored
\`\`\`
\`inline:: also-ignored\`
field2:: value2
			`;
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.has("code")).toBe(false);
			expect(result.has("inline")).toBe(false);
				expect(result.get("Real field")).toEqual(new Set(["value1"]));
				expect(result.get("field2")).toEqual(new Set(["value2"]));
			});

			it("should ignore inline fields in fenced blocks after an empty fenced block", () => {
				const content = `
Id:: outside
\`\`\`
\`\`\`
\`\`\`ad-note
Id:: inside
\`\`\`
				`;
				const result = InlineFieldParser.parseInlineFields(content);

				expect(result.get("Id")).toEqual(new Set(["outside"]));
			});

			it("should parse allowlisted fenced blocks with indented closing fences", () => {
				const content = `
    \`\`\`ad-note
Id:: 121212
    \`\`\`
				`;
				const result = InlineFieldParser.parseInlineFields(content, {
					includeCodeBlocks: ["ad-note"],
				});

				expect(result.get("Id")).toEqual(new Set(["121212"]));
			});

		it("should include fields inside allowlisted fenced code blocks", () => {
			const content = `
Id:: 343434

\`\`\`ad-note
Id:: 121212
\`\`\`

\`\`\`js
Id:: 999999
\`\`\`
			`;
			const result = InlineFieldParser.parseInlineFields(content, {
				includeCodeBlocks: ["ad-note"],
			});

			expect(result.get("Id")).toEqual(new Set(["343434", "121212"]));
		});

		it("should match allowlisted fenced code block types case-insensitively", () => {
			const content = `
\`\`\`Ad-Note title="Meta data"
Id:: 121212
\`\`\`
			`;
			const result = InlineFieldParser.parseInlineFields(content, {
				includeCodeBlocks: ["ad-note"],
			});

			expect(result.get("Id")).toEqual(new Set(["121212"]));
		});

		it("should ignore fields in frontmatter", () => {
			const content = `---
frontmatter:: ignored
tags: [tag1, tag2]
---
realfield:: value
			`;
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.has("frontmatter")).toBe(false);
			expect(result.get("realfield")).toEqual(new Set(["value"]));
		});

		it("should handle fields with spaces before and after", () => {
			const content = "   field1   ::   value1   ";
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.get("field1")).toEqual(new Set(["value1"]));
		});

		it("should not parse task checkboxes as fields", () => {
			const content = `
- [ ] task:: this should not be parsed
- [x] done:: this should not be parsed either
regular:: this should be parsed
			`;
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.has("task")).toBe(false);
			expect(result.has("done")).toBe(false);
			expect(result.get("regular")).toEqual(
				new Set(["this should be parsed"]),
			);
		});

		it("should handle empty values", () => {
			const content = "field1:: \nfield2::value";
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.has("field1")).toBe(false); // Empty values are filtered out
			expect(result.get("field2")).toEqual(new Set(["value"]));
		});

		it("should handle field names with numbers and hyphens", () => {
			const content = "field-1:: value1\nfield_2:: value2\nfield3:: value3";
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.get("field-1")).toEqual(new Set(["value1"]));
			expect(result.get("field_2")).toEqual(new Set(["value2"]));
			expect(result.get("field3")).toEqual(new Set(["value3"]));
		});
	});

	describe("getFieldValues", () => {
		it("should return values for specific field", () => {
			const content = "status:: active\npriority:: high";
			const result = InlineFieldParser.getFieldValues(content, "status");

			expect(result).toEqual(new Set(["active"]));
		});

		it("should return empty set for non-existent field", () => {
			const content = "status:: active";
			const result = InlineFieldParser.getFieldValues(content, "nonexistent");

			expect(result).toEqual(new Set());
		});

		it("should return all values for field with multiple occurrences", () => {
			const content = "tag:: work\ntag:: project\ntag:: urgent";
			const result = InlineFieldParser.getFieldValues(content, "tag");

			expect(result).toEqual(new Set(["work", "project", "urgent"]));
		});

		it("should handle Unicode field names", () => {
			const content = "经验归类:: 技术\n标签:: 测试";
			const result = InlineFieldParser.getFieldValues(content, "经验归类");
			expect(result).toEqual(new Set(["技术"]));
		});

		it("should handle Unicode field names with emoji", () => {
			const content = "📝 Notes:: Important\n🎯 Status:: Complete";
			const result = InlineFieldParser.getFieldValues(content, "📝 Notes");
			expect(result).toEqual(new Set(["Important"]));
		});

		it("should handle Japanese field names", () => {
			const content = "プロジェクト:: 新機能\nステータス:: 完了";
			const result = InlineFieldParser.getFieldValues(content, "プロジェクト");
			expect(result).toEqual(new Set(["新機能"]));
		});

		it("should handle Windows line endings", () => {
			const content = "status:: complete\r\ntag:: important\r\n";
			const result = InlineFieldParser.getFieldValues(content, "status");
			expect(result).toEqual(new Set(["complete"]));
		});

		it("should only include allowlisted fenced code block values", () => {
			const content = `
Id:: 343434
\`\`\`ad-note
Id:: 121212
\`\`\`
\`\`\`js
Id:: 999999
\`\`\`
			`;
			const result = InlineFieldParser.getFieldValues(content, "Id", {
				includeCodeBlocks: ["ad-note"],
			});

			expect(result).toEqual(new Set(["343434", "121212"]));
		});
	});

	describe("fenced code block edge cases", () => {
		it("leaves an unclosed fence intact (behaviour-preserving)", () => {
			// The old regex only stripped a fence once it found a matching
			// closer, so an unclosed opener stripped nothing and its fields
			// still surfaced. The linear scanner preserves that exactly rather
			// than guessing the rest of the note is code.
			const content = `
real:: kept
\`\`\`
secret:: stillseen
trailing:: alsoseen`;
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.get("real")).toEqual(new Set(["kept"]));
			expect(result.get("secret")).toEqual(new Set(["stillseen"]));
			expect(result.get("trailing")).toEqual(new Set(["alsoseen"]));
		});

		it("ignores a nested fence of a shorter backtick run", () => {
			// A 4-backtick fence wrapping a 3-backtick sample (the canonical way
			// to show fenced code inside Markdown) is one block: the inner
			// 3-backtick lines do not close the 4-backtick opener.
			const content = `
before:: a
\`\`\`\`markdown
\`\`\`
inside:: ignored
\`\`\`
\`\`\`\`
after:: b`;
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.get("before")).toEqual(new Set(["a"]));
			expect(result.has("inside")).toBe(false);
			expect(result.get("after")).toEqual(new Set(["b"]));
		});

		it("resumes parsing fields after a properly closed fence", () => {
			const content = `
before:: a
\`\`\`
inside:: ignored
\`\`\`
after:: b`;
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.get("before")).toEqual(new Set(["a"]));
			expect(result.has("inside")).toBe(false);
			expect(result.get("after")).toEqual(new Set(["b"]));
		});

		it("closes a fence with a longer run of backticks (CommonMark >=)", () => {
			const content = `
\`\`\`
inside:: ignored
\`\`\`\`\`
after:: b`;
			const result = InlineFieldParser.parseInlineFields(content);

			expect(result.has("inside")).toBe(false);
			expect(result.get("after")).toEqual(new Set(["b"]));
		});
	});

	describe("ReDoS resistance", () => {
		// Regression guard for the super-linear backtracking that the old
		// FENCED_CODE_BLOCK_REGEX exhibited. The linear line scanner finishes
		// pathological input in well under a millisecond; the old regex took
		// ~10s on 64KB and grew quadratically, so a generous budget keeps the
		// test non-flaky while still failing hard on any regression.
		const BUDGET_MS = 1500;

		it(
			"strips an unclosed fence + long whitespace run in linear time",
			() => {
				const content = "```\n" + " ".repeat(100_000);
				const start = performance.now();
				InlineFieldParser.parseInlineFields(content);
				const elapsed = performance.now() - start;

				expect(elapsed).toBeLessThan(BUDGET_MS);
			},
			20_000,
		);

		it(
			"parses a long whitespace-led line with no field in linear time",
			() => {
				// No fence at all: this exercises INLINE_FIELD_REGEX directly.
				// A long run of leading whitespace with no `::` made the old
				// `[ \t]*([^:\n\r]+?)::` overlap backtrack quadratically.
				const content = " ".repeat(200_000);
				const start = performance.now();
				const result = InlineFieldParser.parseInlineFields(content);
				const elapsed = performance.now() - start;

				expect(result.size).toBe(0);
				expect(elapsed).toBeLessThan(BUDGET_MS);
			},
			20_000,
		);

		it(
			"handles many never-closed fence-open lines in linear time",
			() => {
				// Each line looks like an opening fence with an info string, so
				// none of them is a valid closing fence. The old regex retried
				// from every opener (an O(n^2) outer scan on top of the inner
				// backtracking); the scanner visits each line once.
				const content = Array.from(
					{ length: 50_000 },
					() => "```info",
				).join("\n");
				const start = performance.now();
				InlineFieldParser.parseInlineFields(content);
				const elapsed = performance.now() - start;

				expect(elapsed).toBeLessThan(BUDGET_MS);
			},
			20_000,
		);
	});
});
