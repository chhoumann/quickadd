import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import {
	insertFileLinkToActiveView,
	setMarkdownCursorAtOffset,
} from "./editorInsertion";

function createHarness({
	mode = "source",
	value = "Line A\nCAPTURE\nLine B",
	path = "Target.md",
}: {
	mode?: "source" | "preview";
	value?: string;
	path?: string;
} = {}) {
	const setCursor = vi.fn();
	const offsetToPos = vi.fn((offset: number) => ({ line: 1, ch: offset }));
	const view = {
		file: { path },
		getMode: () => mode,
		editor: {
			getValue: () => value,
			offsetToPos,
			setCursor,
		},
	};
	const app = {
		workspace: {
			getActiveViewOfType: vi.fn(() => view),
		},
	} as unknown as App;
	const file = { path, extension: "md" } as TFile;

	return { app, file, offsetToPos, setCursor };
}

describe("setMarkdownCursorAtOffset", () => {
	it("sets the cursor in the active markdown editor when content matches", () => {
		const { app, file, offsetToPos, setCursor } = createHarness();

		const placed = setMarkdownCursorAtOffset(
			app,
			file,
			"Line A\nCAPTURE\n".length,
			"Line A\nCAPTURE\nLine B",
		);

		expect(placed).toBe(true);
		expect(offsetToPos).toHaveBeenCalledWith("Line A\nCAPTURE\n".length);
		expect(setCursor).toHaveBeenCalledWith({
			line: 1,
			ch: "Line A\nCAPTURE\n".length,
		});
	});

	it("skips preview mode", () => {
		const { app, file, setCursor } = createHarness({ mode: "preview" });

		const placed = setMarkdownCursorAtOffset(
			app,
			file,
			7,
			"Line A\nCAPTURE\nLine B",
		);

		expect(placed).toBe(false);
		expect(setCursor).not.toHaveBeenCalled();
	});

	it("skips when the editor buffer does not match the expected capture write", () => {
		const { app, file, setCursor } = createHarness({ value: "stale" });

		const placed = setMarkdownCursorAtOffset(
			app,
			file,
			7,
			"Line A\nCAPTURE\nLine B",
		);

		expect(placed).toBe(false);
		expect(setCursor).not.toHaveBeenCalled();
	});
});

describe("insertFileLinkToActiveView", () => {
	it("appends configured frontmatter links through the active file", async () => {
		const frontmatter: Record<string, unknown> = {};
		const activeFile = { path: "Folder/Host.md" } as TFile;
		const createdFile = { path: "Folder/Created.md" } as TFile;
		const editor = {
			listSelections: vi.fn(),
			replaceSelection: vi.fn(),
			replaceRange: vi.fn(),
		};
		const app = {
			workspace: {
				getActiveViewOfType: vi.fn(() => ({
					file: activeFile,
					editor,
				})),
			},
			fileManager: {
				generateMarkdownLink: vi.fn(() => "[[Created]]"),
				processFrontMatter: vi.fn(
					async (
						_file: TFile,
						update: (fm: Record<string, unknown>) => void,
					) => update(frontmatter),
				),
			},
		} as unknown as App;

		await expect(
			insertFileLinkToActiveView(app, createdFile, {
				enabled: true,
				placement: "inFrontmatter",
				requireActiveFile: true,
				frontmatterProperty: "related",
				frontmatterHandling: "createProperty",
			}),
		).resolves.toBe(true);

		expect(app.fileManager.generateMarkdownLink).toHaveBeenCalledWith(
			createdFile,
			"Folder/Host.md",
		);
		expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(
			activeFile,
			expect.any(Function),
		);
		expect(frontmatter.related).toEqual(["[[Created]]"]);
		expect(editor.replaceSelection).not.toHaveBeenCalled();
		expect(editor.replaceRange).not.toHaveBeenCalled();
	});

	it("propagates configured frontmatter insertion failures", async () => {
		const app = {
			workspace: {
				getActiveViewOfType: vi.fn(() => ({
					file: { path: "Host.md" },
					editor: {},
				})),
			},
			fileManager: {
				generateMarkdownLink: vi.fn(() => "[[Created]]"),
				processFrontMatter: vi.fn(
					async (
						_file: TFile,
						update: (fm: Record<string, unknown>) => void,
					) => update({}),
				),
			},
		} as unknown as App;

		await expect(
			insertFileLinkToActiveView(app, { path: "Created.md" } as TFile, {
				enabled: true,
				placement: "inFrontmatter",
				requireActiveFile: true,
				frontmatterProperty: "related",
				frontmatterHandling: "error",
			}),
		).rejects.toThrow(/does not exist/);
	});
});
