import type { EditorCommandType } from "./EditorCommandType";
import { CommandType } from "../CommandType";
import { Command } from "../Command";
import type { IEditorCommand } from "./IEditorCommand";

export class EditorCommand extends Command implements IEditorCommand {
	editorCommandType: EditorCommandType;

	constructor(type: EditorCommandType) {
		super(type, CommandType.EditorCommand);

		this.editorCommandType = type;
	}
}
