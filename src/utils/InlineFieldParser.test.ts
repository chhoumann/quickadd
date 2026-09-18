import { describe, it, expect } from "vitest";
import { InlineFieldParser } from "./InlineFieldParser";

type InlineFieldCase={
	name: string;
	content: string;
	options?: Parameters<typeof InlineFieldParser.parseInlineFields>[1];
	expected: Record<string, string[]>;
	absent?: string[];
};
type FieldValueCase=Omit<InlineFieldCase, "expected"|"absent">&{
	field: string;
	expected: string[];
};

describe("InlineFieldParser", () => {
	describe("parseInlineFields", () => {
		it.each<InlineFieldCase>([
			{
				name: "should parse simple inline field",
				content: "Some text\nstatus:: active\nMore text",
				expected: { "status": ["active"] },
			},
			{
				name: "should parse multiple inline fields",
				content: `
Task description
status:: in-progress
priority:: high
assignee:: John Doe
			`,
				expected: { "status": ["in-progress"], "priority": ["high"], "assignee": ["John Doe"] },
			},
			{
				name: "should parse comma-separated values",
				content: "tags:: work, project, urgent",
				expected: { "tags": ["work", "project", "urgent"] },
			},
			{
				name: "should keep a comma inside a wikilink attached to its link",
				content: "Related:: [[Note, with comma]]",
				expected: { "Related": ["[[Note, with comma]]"] },
			},
			{
				name: "should split a wikilink list while preserving inner commas",
				content: "Related:: [[Plain Note]], [[Another, with comma]]",
				expected: { "Related": ["[[Plain Note]]", "[[Another, with comma]]"] },
			},
			{
				name: "should handle multiple occurrences of same field",
				content: `
First note
type:: task
Second note
type:: meeting
Third note
type:: task
			`,
				expected: { "type": ["task", "meeting"] },
			},
			{
				name: "should ignore fields in code blocks",
				content: `
Real field:: value1
\`\`\`
code:: should-be-ignored
\`\`\`
\`inline:: also-ignored\`
field2:: value2
			`,
				expected: { "Real field": ["value1"], "field2": ["value2"] },
				absent: ["code", "inline"],
			},
			{
				name: "should ignore inline fields in fenced blocks after an empty fenced block",
				content: `
Id:: outside
\`\`\`
\`\`\`
\`\`\`ad-note
Id:: inside
\`\`\`
				`,
				expected: { "Id": ["outside"] },
			},
			{
				name: "should parse allowlisted fenced blocks with indented closing fences",
				content: `
    \`\`\`ad-note
Id:: 121212
    \`\`\`
				`,
				options: {
					includeCodeBlocks: ["ad-note"],
				},
				expected: { "Id": ["121212"] },
			},
			{
				name: "should include fields inside allowlisted fenced code blocks",
				content: `
Id:: 343434

\`\`\`ad-note
Id:: 121212
\`\`\`

\`\`\`js
Id:: 999999
\`\`\`
			`,
				options: {
					includeCodeBlocks: ["ad-note"],
				},
				expected: { "Id": ["343434", "121212"] },
			},
			{
				name: "should match allowlisted fenced code block types case-insensitively",
				content: `
\`\`\`Ad-Note title="Meta data"
Id:: 121212
\`\`\`
			`,
				options: {
					includeCodeBlocks: ["ad-note"],
				},
				expected: { "Id": ["121212"] },
			},
			{
				name: "should ignore fields in frontmatter",
				content: `---
frontmatter:: ignored
tags: [tag1, tag2]
---
realfield:: value
			`,
				expected: { "realfield": ["value"] },
				absent: ["frontmatter"],
			},
			{
				name: "should handle fields with spaces before and after",
				content: "   field1   ::   value1   ",
				expected: { "field1": ["value1"] },
			},
			{
				name: "should not parse task checkboxes as fields",
				content: `
- [ ] task:: this should not be parsed
- [x] done:: this should not be parsed either
regular:: this should be parsed
			`,
				expected: { "regular": ["this should be parsed"] },
				absent: ["task", "done"],
			},
			{
				name: "should handle empty values",
				content: "field1:: \nfield2::value",
				expected: { "field2": ["value"] },
				absent: ["field1"],
			},
			{
				name: "should handle field names with numbers and hyphens",
				content: "field-1:: value1\nfield_2:: value2\nfield3:: value3",
				expected: { "field-1": ["value1"], "field_2": ["value2"], "field3": ["value3"] },
			},
		])("$name", ({ content, options, expected, absent }) => {
			const result=InlineFieldParser.parseInlineFields(content, options);
			for(const [field, values] of Object.entries(expected)) {
				expect(result.get(field), field).toEqual(new Set(values));
			}
			for(const field of absent??[]) expect(result.has(field), field).toBe(false);
		});
	});

	describe("getFieldValues", () => {
		it.each<FieldValueCase>([
			{
				name: "should return values for specific field",
				content: "status:: active\npriority:: high",
				field: "status",
				expected: ["active"],
			},
			{
				name: "should return empty set for non-existent field",
				content: "status:: active",
				field: "nonexistent",
				expected: [],
			},
			{
				name: "should return all values for field with multiple occurrences",
				content: "tag:: work\ntag:: project\ntag:: urgent",
				field: "tag",
				expected: ["work", "project", "urgent"],
			},
			{
				name: "should handle Unicode field names",
				content: "经验归类:: 技术\n标签:: 测试",
				field: "经验归类",
				expected: ["技术"],
			},
			{
				name: "should handle Unicode field names with emoji",
				content: "📝 Notes:: Important\n🎯 Status:: Complete",
				field: "📝 Notes",
				expected: ["Important"],
			},
			{
				name: "should handle Japanese field names",
				content: "プロジェクト:: 新機能\nステータス:: 完了",
				field: "プロジェクト",
				expected: ["新機能"],
			},
			{
				name: "should handle Windows line endings",
				content: "status:: complete\r\ntag:: important\r\n",
				field: "status",
				expected: ["complete"],
			},
			{
				name: "should only include allowlisted fenced code block values",
				content: `
Id:: 343434
\`\`\`ad-note
Id:: 121212
\`\`\`
\`\`\`js
Id:: 999999
\`\`\`
			`,
				field: "Id",
				options: {
					includeCodeBlocks: ["ad-note"],
				},
				expected: ["343434", "121212"],
			},
		])("$name", ({ content, field, options, expected }) => {
			expect(InlineFieldParser.getFieldValues(content, field, options)).toEqual(new Set(expected));
		});
	});

	describe("fenced code block edge cases", () => {
		it.each<InlineFieldCase>([
			{
				name: "leaves an unclosed fence intact (behaviour-preserving)",
				content: `
real:: kept
\`\`\`
secret:: stillseen
trailing:: alsoseen`,
				expected: { "real": ["kept"], "secret": ["stillseen"], "trailing": ["alsoseen"] },
			},
			{
				name: "ignores a nested fence of a shorter backtick run",
				content: `
before:: a
\`\`\`\`markdown
\`\`\`
inside:: ignored
\`\`\`
\`\`\`\`
after:: b`,
				expected: { "before": ["a"], "after": ["b"] },
				absent: ["inside"],
			},
			{
				name: "resumes parsing fields after a properly closed fence",
				content: `
before:: a
\`\`\`
inside:: ignored
\`\`\`
after:: b`,
				expected: { "before": ["a"], "after": ["b"] },
				absent: ["inside"],
			},
			{
				name: "closes a fence with a longer run of backticks (CommonMark >=)",
				content: `
\`\`\`
inside:: ignored
\`\`\`\`\`
after:: b`,
				expected: { "after": ["b"] },
				absent: ["inside"],
			},
		])("$name", ({ content, options, expected, absent }) => {
			const result=InlineFieldParser.parseInlineFields(content, options);
			for(const [field, values] of Object.entries(expected)) {
				expect(result.get(field), field).toEqual(new Set(values));
			}
			for(const field of absent??[]) expect(result.has(field), field).toBe(false);
		});
	});

	describe("ReDoS resistance", () => {
		// Regression guard for the super-linear backtracking that the old
		// FENCED_CODE_BLOCK_REGEX exhibited. The linear line scanner finishes
		// pathological input in well under a millisecond; the old regex took
		// ~10s on 64KB and grew quadratically, so a generous budget keeps the
		// test non-flaky while still failing hard on any regression.
		const BUDGET_MS=1500;

		it(
			"strips an unclosed fence + long whitespace run in linear time",
			() => {
				const content="```\n"+" ".repeat(100_000);
				const start=performance.now();
				InlineFieldParser.parseInlineFields(content);
				const elapsed=performance.now()-start;

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
				const content=" ".repeat(200_000);
				const start=performance.now();
				const result=InlineFieldParser.parseInlineFields(content);
				const elapsed=performance.now()-start;

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
				const content=Array.from(
					{ length: 50_000 },
					() => "```info",
				).join("\n");
				const start=performance.now();
				InlineFieldParser.parseInlineFields(content);
				const elapsed=performance.now()-start;

				expect(elapsed).toBeLessThan(BUDGET_MS);
			},
			20_000,
		);
	});
});
