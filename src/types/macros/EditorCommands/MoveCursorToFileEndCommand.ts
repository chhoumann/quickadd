import type { App } from "obsidian";
import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class MoveCursorToFileEndCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.MoveCursorToFileEnd);
	}

	static run(app: App) {
		const activeView = EditorCommand.getActiveMarkdownView(app);
		const lastLine = activeView.editor.lastLine();
		const lineLength = activeView.editor.getLine(lastLine).length;

		activeView.editor.setCursor({ line: lastLine, ch: lineLength });
	}
}
