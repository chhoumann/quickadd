import type { ICommand } from "../ICommand";
import type { EditorCommandType } from "./EditorCommandType";

export interface IEditorCommand extends ICommand {
	editorCommandType: EditorCommandType;
}
