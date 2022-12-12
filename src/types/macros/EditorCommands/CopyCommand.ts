import { EditorCommandType } from "./EditorCommandType";
import type { App } from "obsidian";
import { EditorCommand } from "./EditorCommand";

export class CopyCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.Copy);
	}

	static async run(app: App) {
		const selectedText: string = EditorCommand.getSelectedText(app);
		await navigator.clipboard.writeText(selectedText);
	}
}
