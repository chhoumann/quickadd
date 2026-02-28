import { describe, it, expect } from "vitest";
import { FieldSuggestionParser } from "./FieldSuggestionParser";

describe("FieldSuggestionParser", () => {
	describe("parse", () => {
		it("should parse simple field name without filters", () => {
			const result = FieldSuggestionParser.parse("fieldname");
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: {},
			});
		});

		it("should parse field name with folder filter", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|folder:daily",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: { folder: "daily" },
			});
		});

		it("should parse field name with tag filter", () => {
			const result = FieldSuggestionParser.parse("fieldname|tag:work");
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: { tags: ["work"] },
			});
		});

		it("should parse field name with multiple tag filters", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|tag:work|tag:project",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: { tags: ["work", "project"] },
			});
		});

		it("should parse field name with inline filter", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|inline:true",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: { inline: true },
			});
		});

		it("should parse inline code block allowlist filter", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|inline:true|inline-code-blocks:ad-note, dataview",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: {
					inline: true,
					inlineCodeBlocks: ["ad-note", "dataview"],
				},
			});
		});

		it("should parse field name with multiple filters", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|folder:daily|tag:work|inline:true",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: {
					folder: "daily",
					tags: ["work"],
					inline: true,
				},
			});
		});

		it("should handle tags with # prefix", () => {
			const result = FieldSuggestionParser.parse("fieldname|tag:#work");
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: { tags: ["work"] },
			});
		});

		it("should skip invalid filter format", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|invalidfilter",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: {},
			});
		});

		it("should handle whitespace in input", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname | folder : daily | tag : work",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: {
					folder: "daily",
					tags: ["work"],
				},
			});
		});

		it("should handle folder paths with slashes", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|folder:daily/notes/work",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: { folder: "daily/notes/work" },
			});
		});

		it("should parse default value filters", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|default:Default Value",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: { defaultValue: "Default Value" },
			});
		});

		it("should parse default-empty and default-always filters", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|default:To Do|default-empty:true|default-always:false",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: {
					defaultValue: "To Do",
					defaultEmpty: true,
					defaultAlways: false,
				},
			});
		});

		it("should parse exclusion filters", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|exclude-folder:archive|exclude-tag:deprecated|exclude-file:template.md",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: {
					excludeFolders: ["archive"],
					excludeTags: ["deprecated"],
					excludeFiles: ["template.md"],
				},
			});
		});

		it("should parse case-sensitive filter", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|case-sensitive:true",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: { caseSensitive: true },
			});
		});

		it("should handle complex combinations with all filter types", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|folder:active|tag:project|exclude-folder:archive|default:Planning|default-empty:true|case-sensitive:false",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: {
					folder: "active",
					tags: ["project"],
					excludeFolders: ["archive"],
					defaultValue: "Planning",
					defaultEmpty: true,
					caseSensitive: false,
				},
			});
		});

		it("should handle multiple exclude filters of same type", () => {
			const result = FieldSuggestionParser.parse(
				"fieldname|exclude-folder:archive|exclude-folder:old|exclude-tag:deprecated|exclude-tag:obsolete",
			);
			expect(result).toEqual({
				fieldName: "fieldname",
				filters: {
					excludeFolders: ["archive", "old"],
					excludeTags: ["deprecated", "obsolete"],
				},
			});
		});
	});
});
