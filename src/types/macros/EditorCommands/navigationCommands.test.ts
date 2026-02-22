import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { MoveCursorToFileStartCommand } from "./MoveCursorToFileStartCommand";
import { MoveCursorToFileEndCommand } from "./MoveCursorToFileEndCommand";
import { MoveCursorToLineStartCommand } from "./MoveCursorToLineStartCommand";
import { MoveCursorToLineEndCommand } from "./MoveCursorToLineEndCommand";

interface MockEditor {
	getCursor: () => { line: number; ch: number };
	getLine: (line: number) => string;
	lastLine: () => number;
	setCursor: ReturnType<typeof vi.fn>;
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

describe("navigation editor commands", () => {
	it("moves cursor to file start", () => {
		const setCursor = vi.fn();
		const app = createAppWithEditor({ setCursor });

		MoveCursorToFileStartCommand.run(app);

		expect(setCursor).toHaveBeenCalledWith({ line: 0, ch: 0 });
	});

	it("moves cursor to file end", () => {
		const setCursor = vi.fn();
		const app = createAppWithEditor({
			lastLine: () => 2,
			getLine: (line) => ["first", "second", "third line"][line] ?? "",
			setCursor,
		});

		MoveCursorToFileEndCommand.run(app);

		expect(setCursor).toHaveBeenCalledWith({ line: 2, ch: 10 });
	});

	it("moves cursor to line start", () => {
		const setCursor = vi.fn();
		const app = createAppWithEditor({
			getCursor: () => ({ line: 4, ch: 12 }),
			setCursor,
		});

		MoveCursorToLineStartCommand.run(app);

		expect(setCursor).toHaveBeenCalledWith({ line: 4, ch: 0 });
	});

	it("moves cursor to line end", () => {
		const setCursor = vi.fn();
		const app = createAppWithEditor({
			getCursor: () => ({ line: 7, ch: 2 }),
			getLine: (line) => (line === 7 ? "line length" : ""),
			setCursor,
		});

		MoveCursorToLineEndCommand.run(app);

		expect(setCursor).toHaveBeenCalledWith({ line: 7, ch: 11 });
	});

	it.each([
		{
			name: "MoveCursorToFileStartCommand",
			run: MoveCursorToFileStartCommand.run,
		},
		{
			name: "MoveCursorToFileEndCommand",
			run: MoveCursorToFileEndCommand.run,
		},
		{
			name: "MoveCursorToLineStartCommand",
			run: MoveCursorToLineStartCommand.run,
		},
		{
			name: "MoveCursorToLineEndCommand",
			run: MoveCursorToLineEndCommand.run,
		},
	])("throws when no active markdown view exists: $name", ({ run }) => {
		const app = createAppWithoutMarkdownView();
		expect(() => run(app)).toThrow("no active markdown view.");
	});
});
