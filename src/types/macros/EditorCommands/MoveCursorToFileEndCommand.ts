import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class MoveCursorToFileEndCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.MoveCursorToFileEnd);
	}
}
