import type { App } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorCommandType } from "../types/macros/EditorCommands/EditorCommandType";
import { executeEditorCommand } from "./editorCommands";

const run = (app: App, editorCommandType: EditorCommandType) =>
	executeEditorCommand(app, {
		id: "c1",
		name: editorCommandType,
		type: "EditorCommand",
		editorCommandType,
	} as never);

interface MockEditor {
	getCursor: () => { line: number; ch: number };
	getLine: (line: number) => string;
	lastLine: () => number;
	setCursor: ReturnType<typeof vi.fn>;
	getSelection: () => string;
	replaceSelection: ReturnType<typeof vi.fn>;
}

const createAppWithEditor = (editor: Partial<MockEditor>): App =>
	({
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue({
				editor: {
					getCursor: () => ({ line: 0, ch: 0 }),
					getLine: () => "",
					lastLine: () => 0,
					setCursor: vi.fn(),
					...editor,
				},
			}),
		},
	}) as unknown as App;

const createAppWithoutMarkdownView = (): App =>
	({
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(null),
		},
	}) as unknown as App;

// A Markdown-masquerading view without an editor, as Thino returns (#1536).
const createAppWithEditorlessView = (): App =>
	({
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue({ editor: null }),
		},
	}) as unknown as App;

describe("navigation editor commands", () => {
	it("moves cursor to file start", async () => {
		const setCursor = vi.fn();
		const app = createAppWithEditor({ setCursor });

		await run(app, EditorCommandType.MoveCursorToFileStart);

		expect(setCursor).toHaveBeenCalledWith({ line: 0, ch: 0 });
	});

	it("moves cursor to file end", async () => {
		const setCursor = vi.fn();
		const app = createAppWithEditor({
			lastLine: () => 2,
			getLine: (line) => ["first", "second", "third line"][line] ?? "",
			setCursor,
		});

		await run(app, EditorCommandType.MoveCursorToFileEnd);

		expect(setCursor).toHaveBeenCalledWith({ line: 2, ch: 10 });
	});

	it("moves cursor to line start", async () => {
		const setCursor = vi.fn();
		const app = createAppWithEditor({
			getCursor: () => ({ line: 4, ch: 12 }),
			setCursor,
		});

		await run(app, EditorCommandType.MoveCursorToLineStart);

		expect(setCursor).toHaveBeenCalledWith({ line: 4, ch: 0 });
	});

	it("moves cursor to line end", async () => {
		const setCursor = vi.fn();
		const app = createAppWithEditor({
			getCursor: () => ({ line: 7, ch: 2 }),
			getLine: (line) => (line === 7 ? "line length" : ""),
			setCursor,
		});

		await run(app, EditorCommandType.MoveCursorToLineEnd);

		expect(setCursor).toHaveBeenCalledWith({ line: 7, ch: 11 });
	});

	const allNavigationCommands = [
		{ name: "MoveCursorToFileStart", type: EditorCommandType.MoveCursorToFileStart },
		{ name: "MoveCursorToFileEnd", type: EditorCommandType.MoveCursorToFileEnd },
		{ name: "MoveCursorToLineStart", type: EditorCommandType.MoveCursorToLineStart },
		{ name: "MoveCursorToLineEnd", type: EditorCommandType.MoveCursorToLineEnd },
	];

	it.each(allNavigationCommands)(
		"throws when no active markdown view exists: $name",
		async ({ type }) => {
			const app = createAppWithoutMarkdownView();
			await expect(run(app, type)).rejects.toThrow("no active markdown editor.");
		},
	);

	it.each(allNavigationCommands)(
		"throws when the active view has no editor: $name",
		async ({ type }) => {
			const app = createAppWithEditorlessView();
			await expect(run(app, type)).rejects.toThrow("no active markdown editor.");
		},
	);
});

describe("clipboard editor commands", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("cut moves the selection to the clipboard", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		const replaceSelection = vi.fn();
		const app = createAppWithEditor({
			getSelection: () => "picked",
			replaceSelection,
		});

		await run(app, EditorCommandType.Cut);

		expect(writeText).toHaveBeenCalledWith("picked");
		expect(replaceSelection).toHaveBeenCalledWith("");
	});

	it("cut with nothing selected leaves the clipboard and note alone", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		const replaceSelection = vi.fn();
		const app = createAppWithEditor({ getSelection: () => "", replaceSelection });

		await run(app, EditorCommandType.Cut);

		expect(writeText).not.toHaveBeenCalled();
		expect(replaceSelection).not.toHaveBeenCalled();
	});

	it("paste reads the clipboard, then fails without an editor", async () => {
		const readText = vi.fn().mockResolvedValue("text");
		vi.stubGlobal("navigator", { clipboard: { readText } });

		await expect(
			run(createAppWithoutMarkdownView(), EditorCommandType.Paste),
		).rejects.toThrow("no active markdown editor.");
		expect(readText).toHaveBeenCalled();
	});

	it("paste with format fails without an editor before reading the clipboard", async () => {
		const readText = vi.fn().mockResolvedValue("text");
		vi.stubGlobal("navigator", { clipboard: { readText } });

		await expect(
			run(createAppWithoutMarkdownView(), EditorCommandType.PasteWithFormat),
		).rejects.toThrow("no active markdown editor.");
		expect(readText).not.toHaveBeenCalled();
	});
});

it("runs nothing and reports false for an unknown editor command type", async () => {
	const app = createAppWithoutMarkdownView();

	await expect(
		run(app, "FoldEverything" as EditorCommandType),
	).resolves.toBe(false);
	expect(app.workspace.getActiveViewOfType).not.toHaveBeenCalled();
});
