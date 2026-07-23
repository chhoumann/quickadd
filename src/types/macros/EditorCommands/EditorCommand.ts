import type { EditorCommandType } from "./EditorCommandType";
import { CommandType } from "../CommandType";
import { Command } from "../Command";
import type { IEditorCommand } from "./IEditorCommand";
import type { App } from "obsidian";
import type { MarkdownView } from "obsidian";
import { getActiveMarkdownEditorView } from "../../../utils/activeMarkdownEditor";
import { log } from "../../../logger/logManager";

export abstract class EditorCommand extends Command implements IEditorCommand {
	editorCommandType: EditorCommandType;

	protected constructor(type: EditorCommandType) {
		super(type, CommandType.EditorCommand);

		this.editorCommandType = type;
	}

	static getSelectedText(app: App): string {
		return this.getActiveMarkdownView(app).editor.getSelection();
	}

	static getActiveMarkdownView(app: App): MarkdownView {
		const activeView = getActiveMarkdownEditorView(app);

		if (!activeView) {
			log.logError("no active markdown editor.");
			throw new Error("no active markdown editor.");
		}

		return activeView;
	}
}
