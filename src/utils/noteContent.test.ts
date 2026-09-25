import { describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile, type App, type EditorPosition, type EditorTransaction } from "obsidian";
import {
	getOpenNoteEditorView,
	minimalEdit,
	processNote,
	processNoteFrontMatter,
	writeNote,
} from "./noteContent";

function makeFile(path: string): TFile {
	return Object.assign(new TFile(), { path, extension: "md" });
}

/** An editor over a string that really applies transactions. */
class FakeEditor {
	transactions: EditorTransaction[] = [];
	constructor(public value: string) {}
	getValue() {
		return this.value;
	}
	offsetToPos(offset: number): EditorPosition {
		const lines = this.value.slice(0, offset).split("\n");
		return { line: lines.length - 1, ch: lines[lines.length - 1].length };
	}
	posToOffset(pos: EditorPosition): number {
		const lines = this.value.split("\n");
		let offset = 0;
		for (let line = 0; line < pos.line; line++) offset += lines[line].length + 1;
		return offset + pos.ch;
	}
	transaction(tx: EditorTransaction) {
		this.transactions.push(tx);
		const changes = [...(tx.changes ?? [])]
			.map(change => ({ from: this.posToOffset(change.from), to: this.posToOffset(change.to ?? change.from), text: change.text }))
			.sort((a, b) => b.from - a.from);
		for (const { from, to, text } of changes) this.value = this.value.slice(0, from) + text + this.value.slice(to);
	}
}

/**
 * A vault holding one note on `disk`, optionally open in a view whose `save()`
 * writes unsaved editor text to disk like Obsidian's autosave.
 */
function setup({ disk, editor, unsaved = false, mode = "source", open = "active" }: {
	disk: string;
	editor?: string;
	/** Whether `editor` holds typing not yet saved to `disk`. */
	unsaved?: boolean;
	mode?: "source" | "preview";
	open?: "active" | "background";
}) {
	const file = makeFile("Note.md");
	const state = { disk, events: [] as string[] };
	const fakeEditor = editor === undefined ? undefined : new FakeEditor(editor);
	let saved = unsaved ? undefined : editor;
	const view = Object.assign(Object.create(MarkdownView.prototype) as MarkdownView, {
		file,
		editor: fakeEditor,
		getMode: () => mode,
		save: vi.fn(async () => {
			// Saving takes a while, like a real disk write.
			await new Promise(resolve => setTimeout(resolve, 0));
			state.events.push("save");
			if (fakeEditor && fakeEditor.value !== saved) {
				saved = fakeEditor.value;
				state.disk = fakeEditor.value;
			}
		}),
	});
	const app = {
		vault: {
			read: vi.fn(async () => state.disk),
			modify: vi.fn(async (_file: TFile, content: string) => { state.disk = content; }),
			process: vi.fn(async (_file: TFile, fn: (content: string) => string) => (state.disk = fn(state.disk))),
		},
		workspace: {
			getActiveViewOfType: vi.fn(() => (editor !== undefined && open === "active" ? view : null)),
			getLeavesOfType: vi.fn(() => (editor !== undefined ? [{ view }] : [])),
		},
		fileManager: {
			processFrontMatter: vi.fn(async () => { state.events.push("frontmatter"); }),
		},
	} as unknown as App;
	return { app, file, view, editor: fakeEditor, state };
}

describe("minimalEdit", () => {
	const apply = (before: string, after: string) => {
		const edit = minimalEdit(before, after);
		return edit ? before.slice(0, edit.from) + edit.text + before.slice(edit.to) : before;
	};

	it("returns null for equal text", () => {
		expect(minimalEdit("same", "same")).toBeNull();
	});

	it.each([
		["insert in the middle", "ac", "abc", { from: 1, to: 1, text: "b" }],
		["insert at the start", "bc", "abc", { from: 0, to: 0, text: "a" }],
		["insert at the end", "ab", "abc", { from: 2, to: 2, text: "c" }],
		["delete", "abc", "ac", { from: 1, to: 2, text: "" }],
		["replace", "a big cat", "a red cat", { from: 2, to: 5, text: "red" }],
		["whole-text change", "abc", "xyz", { from: 0, to: 3, text: "xyz" }],
	])("finds the %s", (_name, before, after, edit) => {
		expect(minimalEdit(before, after)).toEqual(edit);
		expect(apply(before, after)).toBe(after);
	});

	it("keeps prefix and suffix from overlapping in repeated characters", () => {
		expect(apply("aa", "aaa")).toBe("aaa");
		expect(apply("aaa", "aa")).toBe("aa");
		expect(apply("abab", "ababab")).toBe("ababab");
		expect(minimalEdit("aa", "aaa")?.text).toBe("a");
	});
});

describe("getOpenNoteEditorView", () => {
	it("returns the active view editing the note", () => {
		const { app, file, view } = setup({ disk: "", editor: "" });
		expect(getOpenNoteEditorView(app, file)).toBe(view);
	});

	it("finds the note open in a background leaf", () => {
		const { app, file, view } = setup({ disk: "", editor: "", open: "background" });
		expect(getOpenNoteEditorView(app, file)).toBe(view);
	});

	it("ignores views of other files", () => {
		const { app } = setup({ disk: "", editor: "" });
		expect(getOpenNoteEditorView(app, makeFile("Other.md"))).toBeNull();
	});

	it("ignores reading view", () => {
		const { app, file } = setup({ disk: "", editor: "", mode: "preview" });
		expect(getOpenNoteEditorView(app, file)).toBeNull();
	});

	it("ignores a view without an editor", () => {
		const { app, file, view } = setup({ disk: "", editor: "" });
		(view as unknown as { editor: undefined }).editor = undefined;
		expect(getOpenNoteEditorView(app, file)).toBeNull();
	});
});

describe("processNote", () => {
	it("goes through vault.process when the note is not open", async () => {
		const { app, file, state } = setup({ disk: "a\n" });

		await expect(processNote(app, file, text => `${text}b\n`)).resolves.toBe("a\nb\n");

		expect(app.vault.process).toHaveBeenCalledOnce();
		expect(state.disk).toBe("a\nb\n");
	});

	it("edits an open editor in place with one minimal change and saves it", async () => {
		// The editor holds typing that autosave has not written yet.
		const { app, file, view, editor, state } = setup({
			disk: "line 1\nline 3\n", editor: "line 1 typed\nline 3\n", unsaved: true,
		});

		const result = await processNote(app, file, text => text.replace("line 3", "line 2\nline 3"));

		expect(result).toBe("line 1 typed\nline 2\nline 3\n");
		expect(editor?.value).toBe(result);
		expect(state.disk).toBe(result);
		expect(editor?.transactions).toEqual([{
			changes: [{ from: { line: 1, ch: 5 }, to: { line: 1, ch: 5 }, text: "2\nline " }],
		}]);
		expect(view.save).toHaveBeenCalledTimes(2);
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(app.vault.modify).not.toHaveBeenCalled();
	});

	it("writes to disk without touching an editor that has not loaded a newer disk write", async () => {
		const { app, file, editor, state } = setup({ disk: "newer on disk\n", editor: "stale\n" });

		const result = await processNote(app, file, text => `${text}added\n`);

		expect(result).toBe("newer on disk\nadded\n");
		expect(state.disk).toBe("newer on disk\nadded\n");
		expect(app.vault.process).toHaveBeenCalledOnce();
		expect(editor?.value).toBe("stale\n");
		expect(editor?.transactions).toEqual([]);
	});

	it("treats a CRLF note shown with LF line endings as in sync", async () => {
		const { app, file, editor } = setup({ disk: "a\r\nb\r\n", editor: "a\nb\n" });

		const result = await processNote(app, file, text => `${text}c\n`);

		expect(result).toBe("a\nb\nc\n");
		expect(editor?.value).toBe("a\nb\nc\n");
		expect(app.vault.process).not.toHaveBeenCalled();
	});

	it("returns LF text when the change itself uses CRLF", async () => {
		const { app, file, editor } = setup({ disk: "a\n", editor: "a\n" });

		await expect(processNote(app, file, text => `${text}b\r\n`)).resolves.toBe("a\nb\n");
		expect(editor?.value).toBe("a\nb\n");
	});

	it("leaves the editor alone when nothing changes", async () => {
		const { app, file, editor } = setup({ disk: "a\n", editor: "a\n" });

		await expect(processNote(app, file, text => text)).resolves.toBe("a\n");
		expect(editor?.transactions).toEqual([]);
	});

	it("writes to disk when the view switches to reading view while the note is read", async () => {
		const { app, file, view, editor, state } = setup({ disk: "a\n", editor: "a\n" });
		vi.mocked(app.vault.read).mockImplementationOnce(async () => {
			view.getMode = () => "preview";
			return state.disk;
		});

		await processNote(app, file, text => `${text}b\n`);

		expect(state.disk).toBe("a\nb\n");
		expect(editor?.transactions).toEqual([]);
	});

	it("waits for an autosave already in flight before reading the disk", async () => {
		const { app, file, view, editor, state } = setup({ disk: "a\n", editor: "a\ntyped\n", unsaved: true });
		const inFlight = view as unknown as { saving: boolean };
		inFlight.saving = true;
		// Like Obsidian, save() returns at once while an earlier save is writing.
		view.save = vi.fn(async () => { if (!inFlight.saving) state.disk = editor?.value ?? ""; });
		setTimeout(() => {
			// The earlier save lands, then re-saves the latest editor text.
			state.disk = editor?.value ?? "";
			inFlight.saving = false;
		}, 30);

		await processNote(app, file, text => `${text}c\n`);

		expect(state.disk).toBe("a\ntyped\nc\n");
		expect(editor?.value).toBe("a\ntyped\nc\n");
		expect(app.vault.process).not.toHaveBeenCalled();
	});
});

describe("writeNote", () => {
	it("writes the new text when the note still matches the base", async () => {
		const { app, file, state } = setup({ disk: "a\nb\n" });

		await expect(writeNote(app, file, "a\nb\n", "a\nb\nc\n")).resolves.toEqual({ content: "a\nb\nc\n", merged: false });
		expect(state.disk).toBe("a\nb\nc\n");
	});

	it("merges edits made to the note since the base was read", async () => {
		const { app, file, state } = setup({ disk: "a edited\nb\n" });

		await expect(writeNote(app, file, "a\nb\n", "a\nb\nc\n"))
			.resolves.toEqual({ content: "a edited\nb\nc\n", merged: true });
		expect(state.disk).toBe("a edited\nb\nc\n");
	});

	it("merges into an open editor holding unsaved typing", async () => {
		const { app, file, editor } = setup({ disk: "a\nb\n", editor: "a typed\nb\n", unsaved: true });

		await expect(writeNote(app, file, "a\nb\n", "a\nb\nc\n"))
			.resolves.toEqual({ content: "a typed\nb\nc\n", merged: true });
		expect(editor?.value).toBe("a typed\nb\nc\n");
	});

	it("refuses to write when the edits conflict", async () => {
		const { app, file, state } = setup({ disk: "a from sync\nb\n" });

		await expect(writeNote(app, file, "a\nb\n", "a from capture\nb\n")).rejects.toThrow("has been modified since the last read");
		expect(state.disk).toBe("a from sync\nb\n");
	});
});

describe("processNoteFrontMatter", () => {
	it("saves the open editor before changing front matter", async () => {
		const { app, file, state } = setup({ disk: "a", editor: "a typed", unsaved: true });
		const update = vi.fn();

		await processNoteFrontMatter(app, file, update);

		expect(state.events).toEqual(["save", "frontmatter"]);
		expect(state.disk).toBe("a typed");
		expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(file, update);
	});
});
