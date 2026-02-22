import type { App } from "obsidian";
import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class MoveCursorToLineEndCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.MoveCursorToLineEnd);
	}

	static run(app: App) {
		const activeView = EditorCommand.getActiveMarkdownView(app);
		const { line: lineNumber } = activeView.editor.getCursor();
		const lineLength = activeView.editor.getLine(lineNumber).length;

		activeView.editor.setCursor({ line: lineNumber, ch: lineLength });
	}
}
