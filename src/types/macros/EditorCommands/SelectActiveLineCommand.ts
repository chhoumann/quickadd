import {EditorCommandType} from "./EditorCommandType";
import {EditorCommand} from "./EditorCommand";
import type {App} from "obsidian";

export class SelectActiveLineCommand extends EditorCommand {
    constructor() {
        super(EditorCommandType.SelectActiveLine);
    }

    public static run(app: App) {
        const activeView = EditorCommand.getActiveMarkdownView(app);

        const {line: lineNumber} = activeView.editor.getCursor();
        const line = activeView.editor.getLine(lineNumber);
        const lineLength = line.length;

        activeView.editor.setSelection({line: lineNumber, ch: 0}, {line: lineNumber, ch: lineLength});
    }
}