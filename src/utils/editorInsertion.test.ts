import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import {
	insertFileLinkToActiveView,
	insertLinkWithPlacement,
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

	it("uses create-or-convert handling by default for frontmatter links", async () => {
		const frontmatter: Record<string, unknown> = { related: "[[Existing]]" };
		const activeFile = { path: "Folder/Host.md" } as TFile;
		const createdFile = { path: "Folder/Created.md" } as TFile;
		const app = {
			workspace: {
				getActiveViewOfType: vi.fn(() => ({
					file: activeFile,
					editor: {},
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
			}),
		).resolves.toBe(true);

		expect(frontmatter.related).toEqual(["[[Existing]]", "[[Created]]"]);
	});

	it("inserts an embed on a new line for newLine placement", async () => {
		const activeFile = { path: "Host.md" } as TFile;
		const createdFile = { path: "Notes/Created.md" } as TFile;
		const replaceRange = vi.fn();
		const editor = {
			listSelections: vi.fn(() => [
				{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
			]),
			replaceSelection: vi.fn(),
			replaceRange,
			getLine: vi.fn(() => "Host line one"),
			posToOffset: vi.fn(
				({ line, ch }: { line: number; ch: number }) => line * 1000 + ch,
			),
		};
		const app = {
			workspace: {
				getActiveViewOfType: vi.fn(() => ({ file: activeFile, editor })),
			},
			fileManager: {
				generateMarkdownLink: vi.fn(() => "[[Created]]"),
			},
			metadataCache: {
				fileToLinktext: vi.fn(() => "Created"),
			},
		} as unknown as App;

		await expect(
			insertFileLinkToActiveView(app, createdFile, {
				enabled: true,
				placement: "newLine",
				requireActiveFile: false,
				linkType: "embed",
				destination: { type: "activeFile" },
			}),
		).resolves.toBe(true);

		// buildFileLinkText wraps the native wikilink text as an embed, and the
		// newLine placement prepends a newline before inserting at end of the line.
		expect(replaceRange).toHaveBeenCalledWith("\n![[Created]]", {
			line: 0,
			ch: "Host line one".length,
		});
		expect(editor.replaceSelection).not.toHaveBeenCalled();
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

type Pos = { line: number; ch: number };

/**
 * Minimal real text-model editor: positions are {line, ch} over a string
 * document, transaction() applies pre-edit-coordinate changes atomically,
 * setSelections() records the resulting cursors.
 */
function createSelectionEditor(
	initial: string,
	initialSelections: Array<{ anchor: Pos; head: Pos }>,
) {
	let content = initial;
	let selections = initialSelections.map((sel) => ({
		anchor: { ...sel.anchor },
		head: { ...sel.head },
	}));

	const posToOffset = ({ line, ch }: Pos): number => {
		const lines = content.split("\n");
		let offset = 0;
		for (let i = 0; i < line; i++) offset += lines[i].length + 1;
		return offset + ch;
	};
	const offsetToPos = (offset: number): Pos => {
		const lines = content.split("\n");
		let line = 0;
		while (line < lines.length && offset > lines[line].length) {
			offset -= lines[line].length + 1;
			line++;
		}
		return { line, ch: offset };
	};

	const transaction = vi.fn(
		({ changes }: { changes: Array<{ from: Pos; to?: Pos; text: string }> }) => {
			const resolved = changes
				.map((change) => ({
					from: posToOffset(change.from),
					to: posToOffset(change.to ?? change.from),
					text: change.text,
				}))
				.sort((a, b) => b.from - a.from);
			for (const change of resolved) {
				content =
					content.slice(0, change.from) +
					change.text +
					content.slice(change.to);
			}
		},
	);

	const editor = {
		listSelections: vi.fn(() => selections),
		getRange: vi.fn((from: Pos, to: Pos) =>
			content.slice(posToOffset(from), posToOffset(to)),
		),
		getLine: vi.fn((line: number) => content.split("\n")[line] ?? ""),
		posToOffset: vi.fn(posToOffset),
		offsetToPos: vi.fn(offsetToPos),
		transaction,
		setSelections: vi.fn(
			(ranges: Array<{ anchor: Pos; head?: Pos }>) => {
				selections = ranges.map((range) => ({
					anchor: { ...range.anchor },
					head: { ...(range.head ?? range.anchor) },
				}));
			},
		),
		replaceSelection: vi.fn(),
		replaceRange: vi.fn(),
	};

	return {
		editor,
		getContent: () => content,
		getSelections: () => selections,
	};
}

function createSelectionApp(
	harness: ReturnType<typeof createSelectionEditor>,
	{ path = "Daily.md" } = {},
) {
	return {
		workspace: {
			getActiveViewOfType: vi.fn(() => ({
				file: { path },
				editor: harness.editor,
			})),
		},
		fileManager: {
			generateMarkdownLink: vi.fn(
				(
					_file: TFile,
					_sourcePath: string,
					_subpath?: string,
					alias?: string,
				) => (alias === undefined ? "[[Created]]" : `[[Created|${alias}]]`),
			),
		},
		metadataCache: {
			fileToLinktext: vi.fn(() => "Created"),
		},
		vault: {
			getConfig: vi.fn(() => false),
		},
	} as unknown as App;
}

describe("insertLinkWithPlacement with textForSelection", () => {
	const linkFor = (selectedText: string) => `[[X|${selectedText}]]`;

	it("replaces a single selection with its own text and collapses the cursor after the link", async () => {
		const harness = createSelectionEditor("see Meeting with Mark today", [
			{ anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 21 } },
		]);
		const app = createSelectionApp(harness);

		await insertLinkWithPlacement(app, "[[X]]", "replaceSelection", {
			textForSelection: linkFor,
		});

		expect(harness.getContent()).toBe("see [[X|Meeting with Mark]] today");
		expect(harness.editor.replaceSelection).not.toHaveBeenCalled();
		expect(harness.editor.transaction).toHaveBeenCalledTimes(1);
		expect(harness.getSelections()).toEqual([
			{
				anchor: { line: 0, ch: "see [[X|Meeting with Mark]]".length },
				head: { line: 0, ch: "see [[X|Meeting with Mark]]".length },
			},
		]);
	});

	it("gives every cursor its own alias in one atomic transaction", async () => {
		const harness = createSelectionEditor("alpha beta\ngamma delta", [
			{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 5 } },
			{ anchor: { line: 1, ch: 6 }, head: { line: 1, ch: 11 } },
		]);
		const app = createSelectionApp(harness);

		await insertLinkWithPlacement(app, "[[X]]", "replaceSelection", {
			textForSelection: linkFor,
		});

		expect(harness.getContent()).toBe("[[X|alpha]] beta\ngamma [[X|delta]]");
		expect(harness.editor.transaction).toHaveBeenCalledTimes(1);
		expect(harness.getSelections()).toEqual([
			{
				anchor: { line: 0, ch: "[[X|alpha]]".length },
				head: { line: 0, ch: "[[X|alpha]]".length },
			},
			{
				anchor: { line: 1, ch: "gamma [[X|delta]]".length },
				head: { line: 1, ch: "gamma [[X|delta]]".length },
			},
		]);
	});

	it("handles reversed selections (head before anchor)", async () => {
		const harness = createSelectionEditor("pick me now", [
			{ anchor: { line: 0, ch: 7 }, head: { line: 0, ch: 5 } },
		]);
		const app = createSelectionApp(harness);

		await insertLinkWithPlacement(app, "[[X]]", "replaceSelection", {
			textForSelection: linkFor,
		});

		expect(harness.getContent()).toBe("pick [[X|me]] now");
	});

	it("passes an empty string for collapsed cursors", async () => {
		const harness = createSelectionEditor("cursor here", [
			{ anchor: { line: 0, ch: 6 }, head: { line: 0, ch: 6 } },
		]);
		const app = createSelectionApp(harness);
		const textForSelection = vi.fn(() => "[[X]]");

		await insertLinkWithPlacement(app, "[[X]]", "replaceSelection", {
			textForSelection,
		});

		expect(textForSelection).toHaveBeenCalledWith("");
		expect(harness.getContent()).toBe("cursor[[X]] here");
	});

	it("keeps the selected text and appends the aliased link for afterSelection", async () => {
		const harness = createSelectionEditor("keep Meeting with Mark here", [
			{ anchor: { line: 0, ch: 5 }, head: { line: 0, ch: 22 } },
		]);
		const app = createSelectionApp(harness);

		await insertLinkWithPlacement(app, "[[X]]", "afterSelection", {
			textForSelection: linkFor,
		});

		expect(harness.getContent()).toBe(
			"keep Meeting with Mark[[X|Meeting with Mark]] here",
		);
		// afterSelection keeps the editor's default selection mapping, matching
		// the existing replaceRange path.
		expect(harness.editor.setSelections).not.toHaveBeenCalled();
	});

	it("leaves the plain replaceSelection path untouched when textForSelection is absent", async () => {
		const harness = createSelectionEditor("some text", [
			{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 4 } },
		]);
		const app = createSelectionApp(harness);

		await insertLinkWithPlacement(app, "[[X]]", "replaceSelection", {});

		expect(harness.editor.replaceSelection).toHaveBeenCalledWith("[[X]]");
		expect(harness.editor.transaction).not.toHaveBeenCalled();
	});
});

describe("insertFileLinkToActiveView displayText", () => {
	it("keeps the selection as the link alias when displayText is 'selection'", async () => {
		const harness = createSelectionEditor("Meeting with Mark", [
			{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 17 } },
		]);
		const app = createSelectionApp(harness);

		await expect(
			insertFileLinkToActiveView(app, { path: "Created.md" } as TFile, {
				enabled: true,
				placement: "replaceSelection",
				requireActiveFile: true,
				linkType: "link",
				displayText: "selection",
				destination: { type: "activeFile" },
			}),
		).resolves.toBe(true);

		expect(harness.getContent()).toBe("[[Created|Meeting with Mark]]");
	});

	it("inserts a plain link when displayText is omitted (legacy behavior)", async () => {
		const harness = createSelectionEditor("Meeting with Mark", [
			{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 17 } },
		]);
		const app = createSelectionApp(harness);

		await expect(
			insertFileLinkToActiveView(app, { path: "Created.md" } as TFile, {
				enabled: true,
				placement: "replaceSelection",
				requireActiveFile: true,
				linkType: "link",
				destination: { type: "activeFile" },
			}),
		).resolves.toBe(true);

		expect(harness.editor.replaceSelection).toHaveBeenCalledWith("[[Created]]");
		expect(harness.editor.transaction).not.toHaveBeenCalled();
	});

	it("normalizes displayText away for embeds even when requested", async () => {
		const harness = createSelectionEditor("Meeting with Mark", [
			{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 17 } },
		]);
		const app = createSelectionApp(harness);

		await expect(
			insertFileLinkToActiveView(app, { path: "Created.md" } as TFile, {
				enabled: true,
				placement: "replaceSelection",
				requireActiveFile: true,
				linkType: "embed",
				displayText: "selection",
				destination: { type: "activeFile" },
			}),
		).resolves.toBe(true);

		expect(harness.editor.replaceSelection).toHaveBeenCalledWith(
			"![[Created]]",
		);
		expect(harness.editor.transaction).not.toHaveBeenCalled();
	});
});

describe("insertFileLinkToActiveView raw-caller guard semantics", () => {
	it("skips silently when a partial options object omits requireActiveFile and no view is active", async () => {
		const app = {
			workspace: { getActiveViewOfType: vi.fn(() => null) },
		} as unknown as App;

		// No "placement" key: normalization would treat this as a legacy value
		// and default requireActiveFile to true. The guard must keep reading the
		// raw value so this stays a silent skip, as before the displayText work.
		await expect(
			insertFileLinkToActiveView(app, { path: "Created.md" } as TFile, {
				enabled: true,
			} as never),
		).resolves.toBe(false);
	});

	it("still throws for strict callers when no view is active", async () => {
		const app = {
			workspace: { getActiveViewOfType: vi.fn(() => null) },
		} as unknown as App;

		await expect(
			insertFileLinkToActiveView(app, { path: "Created.md" } as TFile, {
				enabled: true,
				placement: "replaceSelection",
				requireActiveFile: true,
			}),
		).rejects.toThrow(/no active Markdown view/);
	});

	it("falls back to the plain replaceSelection insert when there are no selections", async () => {
		const harness = createSelectionEditor("doc", []);
		const app = createSelectionApp(harness);

		await insertLinkWithPlacement(app, "[[X]]", "replaceSelection", {
			textForSelection: () => "[[never]]",
		});

		expect(harness.editor.replaceSelection).toHaveBeenCalledWith("[[X]]");
		expect(harness.editor.transaction).not.toHaveBeenCalled();
	});
});
