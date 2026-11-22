import { EditorCommand } from "../../types/macros/EditorCommands/EditorCommand";
import { EditorCommandType } from "../../types/macros/EditorCommands/EditorCommandType";

/** Each editor command's dropdown label, mapped to a factory for a new step. */
export const editorCommands = new Map<string, () => EditorCommand>(
	Object.values(EditorCommandType).map((type) => [type, () => new EditorCommand(type)]),
);
