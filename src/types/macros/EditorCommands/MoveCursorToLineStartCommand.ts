import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class MoveCursorToLineStartCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.MoveCursorToLineStart);
	}
}
