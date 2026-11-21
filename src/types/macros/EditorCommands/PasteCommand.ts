import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class PasteCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.Paste);
	}
}
