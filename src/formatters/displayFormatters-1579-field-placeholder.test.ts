import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";
import type QuickAdd from "../main";

/**
 * Issue #1579. Both preview formatters built the `{{FIELD:...}}` placeholder out
 * of the token's WHOLE inner text, filters included, so the more precisely you
 * filtered the less the preview looked like a value:
 * `{{FIELD:status|folder:Work}}` previewed `status|folder:Work_field_value`.
 * The field is `status`.
 */
const mockApp = {
	workspace: { getActiveFile: () => null },
	vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
	metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
} as unknown as App;

const plugin = {
	settings: { globalVariables: {}, choices: [] },
	getTemplateFiles: () => [],
} as unknown as QuickAdd;

const formatters = [
	["file name", () => new FileNameDisplayFormatter(mockApp, plugin)],
	["format", () => new FormatDisplayFormatter(mockApp, plugin)],
] as const;

describe.each(formatters)("the %s preview names the FIELD", (_label, make) => {
	it.each([
		["no filters", "{{FIELD:status}}", "status_field_value"],
		["one filter", "{{FIELD:status|folder:Work}}", "status_field_value"],
		[
			"several filters",
			"{{FIELD:status|folder:Work|exclude-tag:archive|multi}}",
			"status_field_value",
		],
		// Not a case: `{{FIELD:status,Work}}` previews `status,Work_field_value`,
		// and that is faithful - FieldSuggestionParser splits on `|` only, so the
		// run looks up a property literally named "status,Work" too.
	])("%s", async (_case, input, expected) => {
		expect(await make().format(input)).toBe(expected);
	});

	it("says something neutral when the field name is missing", async () => {
		// Reachable on every keystroke of `{{FIELD:|folder:x}}`. Echoing the raw
		// specifier back here would reprint the filters, which is the bug.
		expect(await make().format("{{FIELD:|folder:Work}}")).toBe("field_value");
	});
});

describe("#1579 the variable KEY still carries the whole specifier", () => {
	it("keeps two differently filtered {{FIELD:status}} tokens apart", async () => {
		// They are different prompts at run time, so they must not collapse onto
		// one variable - even though they now PREVIEW identically.
		const formatter = new FileNameDisplayFormatter(mockApp, plugin);
		await formatter.format("{{FIELD:status|folder:Work}} {{FIELD:status}}");

		const keys = [
			...(formatter as unknown as { variables: Map<string, unknown> }).variables.keys(),
		];
		expect(keys).toEqual([
			"FIELD:status|folder:Work",
			"FIELD:status",
		]);
	});
});
