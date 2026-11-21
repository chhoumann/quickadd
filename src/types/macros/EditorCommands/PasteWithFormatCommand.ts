import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class PasteWithFormatCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.PasteWithFormat);
	}
}
