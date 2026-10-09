import type { App, MarkdownView, TFile } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { getActiveMarkdownEditorView } from "./activeMarkdownEditor";

/**
 * Whether the caller named the run's current note with `current=`. Only then
 * does the run keep that note, and write to it when no editor shows it.
 * Otherwise the current note is the active tab, as it was before `current=`.
 */
export function namesCurrentNote(executor: IChoiceExecutor | undefined): boolean {
	return executor?.triggerContext?.named === true;
}

/**
 * The note a run treats as current: the note the caller named with `current=`,
 * or else the active file, read live so a macro step that opens a note hands it
 * to the next step.
 */
export function currentFile(app: App, executor: IChoiceExecutor | undefined): TFile | null {
	const context = executor?.triggerContext;
	return context?.named ? context.activeFile : app.workspace.getActiveFile();
}

export const CURRENT_NONE_MESSAGE = "This choice needs a current note, and the run was started with current=none.";

/** Whether the caller said there is no current note, with `current=none`. */
export function startedWithCurrentNone(executor: IChoiceExecutor | undefined): boolean {
	const context = executor?.triggerContext;
	return context?.named === true && !context.activeFile;
}

/**
 * What a failure that needs the current note says when there is none: the
 * in-app message, unless the caller said there is none with `current=none`,
 * where "open a file" is advice the caller cannot act on.
 */
export function missingCurrentNoteMessage(executor: IChoiceExecutor | undefined, inApp: string): string {
	return startedWithCurrentNone(executor) ? CURRENT_NONE_MESSAGE : inApp;
}

/** The active Markdown editor, when it shows the run's current note. */
export function currentEditorView(app: App, executor: IChoiceExecutor | undefined): MarkdownView | null {
	const view = getActiveMarkdownEditorView(app);
	const context = executor?.triggerContext;
	if (!context?.named) return view;
	return context.activeFile && view?.file?.path === context.activeFile.path ? view : null;
}

/** The selection in the current note's editor, or "" when no active editor shows it. */
export function currentSelection(app: App, executor: IChoiceExecutor | undefined): string {
	return currentEditorView(app, executor)?.editor.getSelection() ?? "";
}
