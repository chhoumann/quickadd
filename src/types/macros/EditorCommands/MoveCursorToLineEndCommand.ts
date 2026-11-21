import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class MoveCursorToLineEndCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.MoveCursorToLineEnd);
	}
}
