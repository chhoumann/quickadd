import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";
import type QuickAdd from "../main";

// Issue #2197: the previews read `\|` inside a token as `|`, like the run.
const mockApp = {
	workspace: { getActiveFile: () => null },
	vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
	metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
} as unknown as App;

const plugin = {
	settings: { globalVariables: {}, choices: [] },
	getTemplateFiles: () => [],
} as unknown as QuickAdd;

describe.each([
	["file name", () => new FileNameDisplayFormatter(mockApp, plugin)],
	["format", () => new FormatDisplayFormatter(mockApp, plugin)],
] as const)("the %s preview of an escaped pipe inside a token", (_label, make) => {
	it("names the FIELD without its filter", async () => {
		expect(await make().format("{{FIELD:status\\|folder:Work}}")).toBe(
			"status_field_value",
		);
	});
});
