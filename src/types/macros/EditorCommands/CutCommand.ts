import {EditorCommandType} from "./EditorCommandType";
import type {App} from "obsidian";
import {EditorCommand} from "./EditorCommand";
import {log} from "../../../logger/logManager";

export class CutCommand extends EditorCommand {
    constructor() {
        super(EditorCommandType.Cut);
    }

    static async run(app: App) {
        const selectedText: string = EditorCommand.getSelectedText(app);
        const activeView = EditorCommand.getActiveMarkdownView(app);

        if (!selectedText) {
            log.logError("nothing selected.");
            return;
        }

        await navigator.clipboard.writeText(selectedText);
        activeView.editor.replaceSelection("");
    }
}