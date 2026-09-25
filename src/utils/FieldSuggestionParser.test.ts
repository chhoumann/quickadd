import { describe, it, expect } from "vitest";
import { FieldSuggestionParser } from "./FieldSuggestionParser";

describe("FieldSuggestionParser", () => {
	describe("parse", () => {
		it.each<[string, string, ReturnType<typeof FieldSuggestionParser.parse>]>([
			[
				"should parse simple field name without filters",
				"fieldname",
				{
					fieldName: "fieldname",
					filters: {},
				},
			],
			[
				"should parse field name with folder filter",
				"fieldname|folder:daily",
				{
					fieldName: "fieldname",
					filters: { folder: "daily", folders: ["daily"] },
				},
			],
			[
				"parses repeated folder filters as an include list",
				"fieldname|folder:daily|folder:projects",
				{
					fieldName: "fieldname",
					filters: {
						folder: "daily",
						folders: ["daily", "projects"],
					},
				},
			],
			[
				"should parse field name with tag filter",
				"fieldname|tag:work",
				{
					fieldName: "fieldname",
					filters: { tags: ["work"] },
				},
			],
			[
				"should parse field name with multiple tag filters",
				"fieldname|tag:work|tag:project",
				{
					fieldName: "fieldname",
					filters: { tags: ["work", "project"] },
				},
			],
			[
				"should parse field name with inline filter",
				"fieldname|inline:true",
				{
					fieldName: "fieldname",
					filters: { inline: true },
				},
			],
			[
				"should parse inline code block allowlist filter",
				"fieldname|inline:true|inline-code-blocks:ad-note, dataview",
				{
					fieldName: "fieldname",
					filters: {
						inline: true,
						inlineCodeBlocks: ["ad-note", "dataview"],
					},
				},
			],
			[
				"should parse field name with multiple filters",
				"fieldname|folder:daily|tag:work|inline:true",
				{
					fieldName: "fieldname",
					filters: {
						folder: "daily",
						folders: ["daily"],
						tags: ["work"],
						inline: true,
					},
				},
			],
			[
				"should parse multi-select as FIELD behavior, not a filter",
				"fieldname|multi|folder:daily|tag:work",
				{
					fieldName: "fieldname",
					filters: {
						folder: "daily",
						folders: ["daily"],
						tags: ["work"],
					},
					multiSelect: true,
				},
			],
			[
				"should allow multi-select to be explicitly disabled",
				"fieldname|multi:false",
				{
					fieldName: "fieldname",
					filters: {},
				},
			],
			[
				"should handle tags with # prefix",
				"fieldname|tag:#work",
				{
					fieldName: "fieldname",
					filters: { tags: ["work"] },
				},
			],
			[
				"should skip invalid filter format",
				"fieldname|invalidfilter",
				{
					fieldName: "fieldname",
					filters: {},
				},
			],
			[
				"should handle whitespace in input",
				"fieldname | folder : daily | tag : work",
				{
					fieldName: "fieldname",
					filters: {
						folder: "daily",
						folders: ["daily"],
						tags: ["work"],
					},
				},
			],
			[
				"should handle folder paths with slashes",
				"fieldname|folder:daily/notes/work",
				{
					fieldName: "fieldname",
					filters: {
						folder: "daily/notes/work",
						folders: ["daily/notes/work"],
					},
				},
			],
			[
				"should parse default value filters",
				"fieldname|default:Default Value",
				{
					fieldName: "fieldname",
					filters: { defaultValue: "Default Value" },
				},
			],
			[
				"parses default-from:active into a lowercased defaultFrom (issue #1429)",
				"project|default-from:active",
				{
					fieldName: "project",
					filters: { defaultFrom: "active" },
				},
			],
			[
				"lowercases the default-from source value",
				"project|default-from:Active",
				{
					fieldName: "project",
					filters: { defaultFrom: "active" },
				},
			],
			[
				"keeps default-from alongside the literal default and other filters",
				"project|folder:Projects|default:Inbox|default-from:active",
				{
					fieldName: "project",
					filters: {
						folder: "Projects",
						folders: ["Projects"],
						defaultValue: "Inbox",
						defaultFrom: "active",
					},
				},
			],
			[
				"should parse default-empty and default-always filters",
				"fieldname|default:To Do|default-empty:true|default-always:false",
				{
					fieldName: "fieldname",
					filters: {
						defaultValue: "To Do",
						defaultEmpty: true,
						defaultAlways: false,
					},
				},
			],
			[
				"should parse exclusion filters",
				"fieldname|exclude-folder:archive|exclude-tag:deprecated|exclude-file:template.md",
				{
					fieldName: "fieldname",
					filters: {
						excludeFolders: ["archive"],
						excludeTags: ["deprecated"],
						excludeFiles: ["template.md"],
					},
				},
			],
			[
				"should parse case-sensitive filter",
				"fieldname|case-sensitive:true",
				{
					fieldName: "fieldname",
					filters: { caseSensitive: true },
				},
			],
			[
				"should handle complex combinations with all filter types",
				"fieldname|folder:active|tag:project|exclude-folder:archive|default:Planning|default-empty:true|case-sensitive:false",
				{
					fieldName: "fieldname",
					filters: {
						folder: "active",
						folders: ["active"],
						tags: ["project"],
						excludeFolders: ["archive"],
						defaultValue: "Planning",
						defaultEmpty: true,
						caseSensitive: false,
					},
				},
			],
			[
				"should handle multiple exclude filters of same type",
				"fieldname|exclude-folder:archive|exclude-folder:old|exclude-tag:deprecated|exclude-tag:obsolete",
				{
					fieldName: "fieldname",
					filters: {
						excludeFolders: ["archive", "old"],
						excludeTags: ["deprecated", "obsolete"],
					},
				},
			],
			[
				"keeps the label out of the filters (issue #1797)",
				"project|folder:Projects|label:Which project?",
				{
					fieldName: "project",
					filters: { folder: "Projects", folders: ["Projects"] },
					label: "Which project?",
				},
			],
			[
				"keeps colons inside a label",
				"project|label:Project: primary",
				{
					fieldName: "project",
					filters: {},
					label: "Project: primary",
				},
			],
			[
				"ignores an empty label",
				"project|label:",
				{ fieldName: "project", filters: {} },
			],
		])("%s", (_name, input, expected) => {
			expect(FieldSuggestionParser.parse(input)).toEqual(expected);
		});

		it("parses an explicit multi-select format", () => {
			const result=FieldSuggestionParser.parse(
				"topics|multi|format:markdown",
			);
			expect(result.multiSelect).toBe(true);
			expect(result.multiFormat).toBe("markdown");
		});

		it("parses |format:spaced", () => {
			const result=FieldSuggestionParser.parse(
				"topics|multi|format:spaced",
			);
			expect(result.multiSelect).toBe(true);
			expect(result.multiFormat).toBe("spaced");
		});

		it("warns on |format: without |multi, even |format:auto", () => {
			const warnings: string[]=[];
			const result=FieldSuggestionParser.parse("topics|format:auto", {
				warn: (msg) => warnings.push(msg),
			});
			expect(result.multiFormat).toBeUndefined();
			expect(warnings.some((m) => m.includes("needs |multi"))).toBe(true);
		});

















	});
});
