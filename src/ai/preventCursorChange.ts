import type { App } from "obsidian";

export function preventCursorChange(app: App): () => void {
	const cursor = app.workspace.activeEditor?.editor?.getCursor();
	const selection = app.workspace.activeEditor?.editor?.listSelections();

	return () => {
		if (cursor) app.workspace.activeEditor?.editor?.setCursor(cursor);
		if (selection)
			app.workspace.activeEditor?.editor?.setSelections(selection);
	};
}
