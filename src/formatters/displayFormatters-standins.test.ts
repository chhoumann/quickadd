import { describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { FormatDisplayFormatter } from "./formatDisplayFormatter";
import { FileNameDisplayFormatter } from "./fileNameDisplayFormatter";
import type QuickAdd from "../main";

/**
 * The stand-ins both previews show for prompts they never open. The file-name
 * row shows the same text unless it could not be part of a file name, when it
 * falls back to a neutral stand-in (#1578).
 */

const app = {
	workspace: { getActiveFile: () => null },
	vault: { getMarkdownFiles: () => [], getAbstractFileByPath: () => null },
	metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
} as unknown as App;

const plugin = {
	settings: { globalVariables: {}, choices: [] },
	getTemplateFiles: () => [],
} as unknown as QuickAdd;

async function preview(input: string, variables: Record<string, unknown> = {}) {
	const body = new FormatDisplayFormatter(app, plugin);
	const fileName = new FileNameDisplayFormatter(app, plugin);
	for (const formatter of [body, fileName]) {
		const map = (formatter as unknown as { variables: Map<string, unknown> }).variables;
		for (const [key, value] of Object.entries(variables)) map.set(key, value);
	}
	return { body: await body.format(input), fileName: await fileName.format(input) };
}

describe("preview stand-ins", () => {
	it.each([
		["{{VALUE}}", "user input", "user input"],
		["{{VALUE|label:Due: date}}", "Due: date", "user input"],
		["{{VALUE:project}}", "Project Alpha", "Project Alpha"],
		["{{VALUE:when}}", "when_value", "when_value"],
		["{{VALUE:due: x}}", "due: x_value", "user input"],
		["{{MACRO:clipboard}}", "clipboard_content", "clipboard_content"],
		["{{MACRO:a:b}}", "a:b_output", "macro_output"],
		["{{FIELD:status}}", "status_field_value", "status_field_value"],
		["{{FIELD:a:b}}", "a:b_field_value", "field_value"],
	])("%s previews as %s in the body and %s in the file name", async (input, body, fileName) => {
		await expect(preview(input)).resolves.toEqual({ body, fileName });
	});

	it("shows a stored non-string value's example, sanitized only in the file name", async () => {
		await expect(preview("{{VALUE:a:b}}", { "a:b": 3 })).resolves.toEqual({
			body: "a:b_example",
			fileName: "user input",
		});
		await expect(preview("{{VALUE:client}}", { client: 3 })).resolves.toEqual({
			body: "Acme Corp",
			fileName: "Acme Corp",
		});
	});
});
