import type { App } from "obsidian";
import { MarkdownView } from "obsidian";

/**
 * The active MarkdownView, but only when it actually exposes an editor.
 *
 * Some plugins (e.g. Thino) patch `Workspace.getActiveViewOfType` to answer
 * Markdown lookups with their own Markdown-masquerading view whose `editor`
 * is null. Every editor-dependent code path must treat such a view exactly
 * like "no active Markdown view" (#1536).
 */
export function getActiveMarkdownEditorView(app: App): MarkdownView | null {
	const view = app.workspace.getActiveViewOfType(MarkdownView);
	return view?.editor ? view : null;
}
