import type { App } from "obsidian";
import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class MoveCursorToLineStartCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.MoveCursorToLineStart);
	}

	static run(app: App) {
		const activeView = EditorCommand.getActiveMarkdownView(app);
		const { line: lineNumber } = activeView.editor.getCursor();

		activeView.editor.setCursor({ line: lineNumber, ch: 0 });
	}
}
