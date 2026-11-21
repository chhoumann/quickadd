import { EditorCommand } from "./EditorCommand";
import { EditorCommandType } from "./EditorCommandType";

export class SelectLinkOnActiveLineCommand extends EditorCommand {
	constructor() {
		super(EditorCommandType.SelectLinkOnActiveLine);
	}
}
