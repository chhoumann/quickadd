import { describe, expect, it, vi } from "vitest";
import { App, TFile } from "obsidian";
import { isTemplaterTriggerOnCreateEnabled, jumpToNextTemplaterCursorIfPossible, templaterParseTemplate } from "./utilityObsidian";

describe("isTemplaterTriggerOnCreateEnabled", () => {
	it.each([true, false])("reads the current local setting: %s", (enabled) => {
		const app = new App();
		Object.assign(app.plugins.plugins, {
			"templater-obsidian": {
				settings: { data_version: 2, trigger_on_file_creation_mode: "folder" },
			},
		});
		app.loadLocalStorage = vi.fn(() => ({ trigger_on_file_creation: enabled }));

		expect(isTemplaterTriggerOnCreateEnabled(app)).toBe(enabled);
		expect(app.loadLocalStorage).toHaveBeenCalledWith("templater-local-settings");
	});

	it.each([true, false])("preserves the legacy setting over local storage: %s", (enabled) => {
		const app = new App();
		Object.assign(app.plugins.plugins, {
			"templater-obsidian": { settings: { trigger_on_file_creation: enabled } },
		});
		app.loadLocalStorage = vi.fn(() => ({ trigger_on_file_creation: !enabled }));

		expect(isTemplaterTriggerOnCreateEnabled(app)).toBe(enabled);
		expect(app.loadLocalStorage).not.toHaveBeenCalled();
	});

	it.each([undefined, null, {}, [], "true", { trigger_on_file_creation: "true" }])(
		"ignores absent or malformed local settings: %j",
		(localSettings) => {
			const app = new App();
			Object.assign(app.plugins.plugins, { "templater-obsidian": { settings: {} } });
			app.loadLocalStorage = () => localSettings;

			expect(isTemplaterTriggerOnCreateEnabled(app)).toBe(false);
		},
	);

	it("requires the Templater plugin to be loaded", () => {
		const app = new App();
		app.loadLocalStorage = vi.fn(() => ({ trigger_on_file_creation: true }));

		expect(isTemplaterTriggerOnCreateEnabled(app)).toBe(false);
		expect(app.loadLocalStorage).not.toHaveBeenCalled();
	});
});

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
		(app as any).workspace.getActiveViewOfType = () => ({
			file,
			editor: { getCursor: () => ({ line: 1, ch: 2 }) },
		});

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

		await expect(
			jumpToNextTemplaterCursorIfPossible(app as any, file as any),
		).resolves.toBe(false);
	});

	it("returns true when Templater moves the active editor cursor", async () => {
		const app = new App();
		const file = new TFile();
		file.path = "QA.md";
		file.extension = "md";
		let cursor = { line: 1, ch: 2 };

		(app as any).workspace.getActiveFile = () => file;
		(app as any).workspace.getActiveViewOfType = () => ({
			file,
			editor: { getCursor: () => cursor },
		});

		const editorHandler = {
			jump_to_next_cursor_location: async () => {
				cursor = { line: 3, ch: 4 };
			},
		};

		(app as any).plugins.plugins["templater-obsidian"] = {
			settings: { auto_jump_to_cursor: true },
			editor_handler: editorHandler,
		};

		await expect(
			jumpToNextTemplaterCursorIfPossible(app as any, file as any),
		).resolves.toBe(true);
	});

	it("returns true when Templater consumes a cursor marker at the current position", async () => {
		const app = new App();
		const file = new TFile();
		file.path = "QA.md";
		file.extension = "md";
		let content = "<% tp.file.cursor() %>Capture text";

		(app as any).workspace.getActiveFile = () => file;
		(app as any).workspace.getActiveViewOfType = () => ({
			file,
			editor: {
				getCursor: () => ({ line: 0, ch: 0 }),
				getValue: () => content,
			},
		});

		const editorHandler = {
			jump_to_next_cursor_location: async () => {
				content = "Capture text";
			},
		};

		(app as any).plugins.plugins["templater-obsidian"] = {
			settings: { auto_jump_to_cursor: true },
			editor_handler: editorHandler,
		};

		await expect(
			jumpToNextTemplaterCursorIfPossible(app as any, file as any),
		).resolves.toBe(true);
	});

	it("returns true when Templater consumes an ordered cursor marker", async () => {
		const app = new App();
		const file = new TFile();
		file.path = "QA.md";
		file.extension = "md";
		let content = "<% tp.file.cursor(1) %>Capture text";

		(app as any).workspace.getActiveFile = () => file;
		(app as any).workspace.getActiveViewOfType = () => ({
			file,
			editor: {
				getCursor: () => ({ line: 0, ch: 0 }),
				getValue: () => content,
			},
		});

		const editorHandler = {
			jump_to_next_cursor_location: async () => {
				content = "Capture text";
			},
		};

		(app as any).plugins.plugins["templater-obsidian"] = {
			settings: { auto_jump_to_cursor: true },
			editor_handler: editorHandler,
		};

		await expect(
			jumpToNextTemplaterCursorIfPossible(app as any, file as any),
		).resolves.toBe(true);
	});

	it("returns false when Templater neither moves nor consumes a cursor marker", async () => {
		const app = new App();
		const file = new TFile();
		file.path = "QA.md";
		file.extension = "md";

		(app as any).workspace.getActiveFile = () => file;
		(app as any).workspace.getActiveViewOfType = () => ({
			file,
			editor: {
				getCursor: () => ({ line: 1, ch: 2 }),
				getValue: () => "Capture text",
			},
		});

		const editorHandler = {
			jump_to_next_cursor_location: async () => {
				// Templater returns void even when no cursor marker exists.
				await Promise.resolve();
			},
		};

		(app as any).plugins.plugins["templater-obsidian"] = {
			settings: { auto_jump_to_cursor: true },
			editor_handler: editorHandler,
		};

		await expect(
			jumpToNextTemplaterCursorIfPossible(app as any, file as any),
		).resolves.toBe(false);
	});

	it("returns false when Templater auto jump is disabled", async () => {
		const app = new App();
		const file = new TFile();
		file.path = "QA.md";
		file.extension = "md";

		(app as any).workspace.getActiveFile = () => file;
		(app as any).plugins.plugins["templater-obsidian"] = {
			settings: { auto_jump_to_cursor: false },
		};

		await expect(
			jumpToNextTemplaterCursorIfPossible(app as any, file as any),
		).resolves.toBe(false);
	});
});
