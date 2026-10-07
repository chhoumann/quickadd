import type { App, MarkdownView, TFile } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { getActiveMarkdownEditorView } from "./activeMarkdownEditor";

/**
 * The note a run treats as current: the note the caller named with `current=`,
 * or else the active file, read live so a macro step that opens a note hands it
 * to the next step.
 */
export function currentFile(app: App, executor: IChoiceExecutor | undefined): TFile | null {
	const context = executor?.triggerContext;
	return context?.named ? context.activeFile : app.workspace.getActiveFile();
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
