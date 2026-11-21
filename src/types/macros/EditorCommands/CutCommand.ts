import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class CutCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.Cut);
	}
}
