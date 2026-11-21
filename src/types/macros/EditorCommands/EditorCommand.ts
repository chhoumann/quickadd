import type { EditorCommandType } from "./EditorCommandType";
import { CommandType } from "../CommandType";
import { Command } from "../Command";
import type { IEditorCommand } from "./IEditorCommand";

export abstract class EditorCommand extends Command implements IEditorCommand {
	editorCommandType: EditorCommandType;

	protected constructor(type: EditorCommandType) {
		super(type, CommandType.EditorCommand);

		this.editorCommandType = type;
	}
}
