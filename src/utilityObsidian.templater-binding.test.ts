import { describe, expect, it } from "vitest";
import { App, TFile } from "obsidian";
import { jumpToNextTemplaterCursorIfPossible, templaterParseTemplate } from "./utilityObsidian";

describe("templaterParseTemplate", () => {
	it("calls parse_template with the correct `this` context", async () => {
		const app = new App();
		const file = new TFile();
		file.path = "QA.md";
		file.extension = "md";

		const templater = {
			functions_generator: { ok: true },
			parse_template: async function (
				this: any,
				_opts: unknown,
				content: string,
			): Promise<string> {
				expect(this?.functions_generator?.ok).toBe(true);
				return `rendered:${content}`;
			},
		};

		(app as any).plugins.plugins["templater-obsidian"] = { templater };

		const result = await templaterParseTemplate(app as any, "hello", file as any);
		expect(result).toBe("rendered:hello");
	});
});

describe("jumpToNextTemplaterCursorIfPossible", () => {
	it("calls jump_to_next_cursor_location with the correct `this` context", async () => {
		const app = new App();
		const file = new TFile();
		file.path = "QA.md";
		file.extension = "md";

		(app as any).workspace.getActiveFile = () => file;

		const editorHandler = {
			plugin: { ok: true },
			jump_to_next_cursor_location: async function (
				this: any,
				_targetFile: unknown,
				_autoJump: unknown,
			): Promise<void> {
				expect(this?.plugin?.ok).toBe(true);
			},
		};

		(app as any).plugins.plugins["templater-obsidian"] = {
			settings: { auto_jump_to_cursor: true },
			editor_handler: editorHandler,
		};

		await jumpToNextTemplaterCursorIfPossible(app as any, file as any);
	});
});
