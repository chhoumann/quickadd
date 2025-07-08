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
			const content =
				"field-1:: value1\nfield_2:: value2\nfield3:: value3";
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
			const result = InlineFieldParser.getFieldValues(
				content,
				"nonexistent",
			);

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
	});
});