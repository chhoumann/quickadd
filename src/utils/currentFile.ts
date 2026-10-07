import type { App, MarkdownView, TFile } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { getActiveMarkdownEditorView } from "./activeMarkdownEditor";

/**
 * The note a run treats as current: the one its trigger context fixed when the
 * run began (the active tab then, or the note the CLI named with `current=`).
 * Outside a choice execution no context exists, and the active file is read live.
 */
export function currentFile(app: App, executor: IChoiceExecutor | undefined): TFile | null {
	const context = executor?.triggerContext;
	return context ? context.activeFile : app.workspace.getActiveFile();
}

/** The active Markdown editor, when it shows the run's current note. */
export function currentEditorView(app: App, executor: IChoiceExecutor | undefined): MarkdownView | null {
	const context = executor?.triggerContext;
	const view = getActiveMarkdownEditorView(app);
	if (!context) return view;
	return context.activeFile && view?.file?.path === context.activeFile.path ? view : null;
}

/** The selection in the current note's editor, or "" when no active editor shows it. */
export function currentSelection(app: App, executor: IChoiceExecutor | undefined): string {
	return currentEditorView(app, executor)?.editor.getSelection() ?? "";
}
