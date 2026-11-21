import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class MoveCursorToFileStartCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.MoveCursorToFileStart);
	}
}
