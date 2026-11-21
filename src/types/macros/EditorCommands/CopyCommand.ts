import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class CopyCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.Copy);
	}
}
