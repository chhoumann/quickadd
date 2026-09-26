import { MarkdownView, type App, type TFile } from "obsidian";
import { waitFor } from "../utility";
import merge from "three-way-merge";
import invariant from "./invariant";

/*
 * Reads and writes of a note's full text that stay coherent with an open editor.
 *
 * Obsidian feeds a vault write back into an open editor on its own schedule:
 * notes over its 64K-character content cache are re-read from disk after
 * `vault.modify` resolves, and unsaved typing is 3-way merged behind a
 * "modified externally" notice. Anything that then reads the editor, or
 * places a cursor by offset, sees other text than QuickAdd wrote (#1798).
 * When the note is open in a source or live-preview editor, these helpers
 * write through that editor instead, as Obsidian's plugin guidelines
 * recommend, so it holds the result as soon as they resolve.
 */

const SAVE_TIMEOUT_MS = 10_000;

/** A loaded Markdown view editing `file`, preferring the active one. */
export function getOpenNoteEditorView(app: App, file: TFile): MarkdownView | null {
	// Reading view keeps its own copy of the text: saving it would write that
	// copy, not the editor's, so only source/live-preview views qualify.
	const editing = (view: unknown): view is MarkdownView =>
		view instanceof MarkdownView && view.file === file && !!view.editor && view.getMode() === "source";
	const active = app.workspace.getActiveViewOfType(MarkdownView);
	if (editing(active)) return active;
	return app.workspace.getLeavesOfType("markdown").map(leaf => leaf.view).find(editing) ?? null;
}

/** Saves unsaved editor text so disk-based reads and writes see what the user sees. */
export async function flushNote(app: App, file: TFile): Promise<void> {
	const view = getOpenNoteEditorView(app, file);
	if (view) await saveView(view);
}

/** The note's current text, including typing its editor has not autosaved yet. */
export async function readNote(app: App, file: TFile): Promise<string> {
	await flushNote(app, file);
	return app.vault.read(file);
}

/**
 * Like `vault.process`, but an open editor is changed in place with one
 * minimal edit, so its cursor, folds, scroll, and undo history survive and it
 * already holds the result when this resolves. Falls back to `vault.process`
 * when no editor is in sync with disk. Returns the written text (LF when it
 * went through the editor).
 */
export async function processNote(app: App, file: TFile, fn: (content: string) => string): Promise<string> {
	const view = getOpenNoteEditorView(app, file);
	if (view) {
		await saveView(view);
		const disk = await app.vault.read(file);
		const { editor } = view;
		const before = editor.getValue();
		// An editor that differs from disk right after saving has yet to load a
		// newer disk write; editing it would save stale text over that write.
		// The view may also have closed, left the note, or switched to reading
		// view while the note was read.
		if (getOpenNoteEditorView(app, file) === view && before === toLF(disk)) {
			const after = toLF(fn(before));
			const edit = minimalEdit(before, after);
			if (edit) {
				editor.transaction({ changes: [{
					from: editor.offsetToPos(edit.from), to: editor.offsetToPos(edit.to), text: edit.text,
				}] });
				await saveView(view);
			}
			return after;
		}
	}
	return app.vault.process(file, fn);
}

/**
 * Replaces `base` (the text read earlier) with `next`. Edits made to the note
 * in between are 3-way merged in (`merged: true`), or the write is refused
 * when they conflict, so nothing is lost.
 */
export async function writeNote(app: App, file: TFile, base: string, next: string): Promise<{ content: string; merged: boolean }> {
	let merged = false;
	const content = await processNote(app, file, current => {
		if (toLF(current) === toLF(base)) return next;
		const result = merge(toLF(current), toLF(base), toLF(next));
		invariant(result.isSuccess(), () =>
			`The file ${file.path} has been modified since the last read.\nQuickAdd could not merge the two versions without conflicts, and will not modify the file.\nThis is in order to prevent data loss.`);
		merged = true;
		return result.joinedResults() as string;
	});
	return { content, merged };
}

/**
 * `processFrontMatter` for a note that may be open: flushing first keeps the
 * editor from 3-way merging the write behind a "modified externally" notice.
 */
export async function processNoteFrontMatter(
	app: App,
	file: TFile,
	fn: (frontmatter: Record<string, unknown>) => void,
): Promise<void> {
	await flushNote(app, file);
	await app.fileManager.processFrontMatter(file, fn);
}

async function saveView(view: MarkdownView): Promise<void> {
	await view.save();
	// save() returns at once while an earlier save is still writing; that save
	// then re-saves the latest text. Wait for both before trusting the disk,
	// and write nothing if they never finish, since they would overwrite it.
	const saving = () => (view as unknown as { saving?: boolean }).saving === true;
	for (let waited = 0; saving(); waited += 10) {
		if (waited >= SAVE_TIMEOUT_MS) throw new Error(`Obsidian is still saving '${view.file?.path}'. Try again once it has saved.`);
		await waitFor(10);
	}
}

/** The single replacement turning `before` into `after`, or null when they are equal. */
export function minimalEdit(before: string, after: string): { from: number; to: number; text: string } | null {
	if (before === after) return null;
	const max = Math.min(before.length, after.length);
	let prefix = 0;
	while (prefix < max && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix++;
	let suffix = 0;
	while (suffix < max - prefix &&
		before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++;
	return { from: prefix, to: before.length - suffix, text: after.slice(prefix, after.length - suffix) };
}

function toLF(text: string): string {
	return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}
