import type { App } from "obsidian";
import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class MoveCursorToFileStartCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.MoveCursorToFileStart);
	}

	static run(app: App) {
		const activeView = EditorCommand.getActiveMarkdownView(app);
		activeView.editor.setCursor({ line: 0, ch: 0 });
	}
}
