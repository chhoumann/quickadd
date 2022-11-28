import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";
import type { App } from "obsidian";
import { WIKI_LINK_REGEX } from "../../../constants";
import { log } from "../../../logger/logManager";

export class SelectLinkOnActiveLineCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.SelectLinkOnActiveLine);
	}

	static async run(app: App) {
		const activeView = EditorCommand.getActiveMarkdownView(app);

		const { line: lineNumber } = activeView.editor.getCursor();
		const line = activeView.editor.getLine(lineNumber);

		const match = WIKI_LINK_REGEX.exec(line);
		if (!match) {
			log.logError(`no internal link found on line ${lineNumber}.`);
			return;
		}

		const matchStart: number = match.index;
		const matchEnd: number = match[0].length + matchStart;

		activeView.editor.setSelection(
			{ line: lineNumber, ch: matchStart },
			{ line: lineNumber, ch: matchEnd }
		);
	}
}
