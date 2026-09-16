import type { IEditorCommand } from "../../types/macros/EditorCommands/IEditorCommand";
import { EditorCommandType } from "../../types/macros/EditorCommands/EditorCommandType";
import { CopyCommand } from "../../types/macros/EditorCommands/CopyCommand";
import { CutCommand } from "../../types/macros/EditorCommands/CutCommand";
import { PasteCommand } from "../../types/macros/EditorCommands/PasteCommand";
import { PasteWithFormatCommand } from "../../types/macros/EditorCommands/PasteWithFormatCommand";
import { SelectActiveLineCommand } from "../../types/macros/EditorCommands/SelectActiveLineCommand";
import { SelectLinkOnActiveLineCommand } from "../../types/macros/EditorCommands/SelectLinkOnActiveLineCommand";
import { MoveCursorToFileStartCommand } from "../../types/macros/EditorCommands/MoveCursorToFileStartCommand";
import { MoveCursorToFileEndCommand } from "../../types/macros/EditorCommands/MoveCursorToFileEndCommand";
import { MoveCursorToLineStartCommand } from "../../types/macros/EditorCommands/MoveCursorToLineStartCommand";
import { MoveCursorToLineEndCommand } from "../../types/macros/EditorCommands/MoveCursorToLineEndCommand";

export const editorCommands = new Map(Object.entries({
	[EditorCommandType.Copy]: CopyCommand,
	[EditorCommandType.Cut]: CutCommand,
	[EditorCommandType.Paste]: PasteCommand,
	[EditorCommandType.PasteWithFormat]: PasteWithFormatCommand,
	[EditorCommandType.SelectActiveLine]: SelectActiveLineCommand,
	[EditorCommandType.SelectLinkOnActiveLine]: SelectLinkOnActiveLineCommand,
	[EditorCommandType.MoveCursorToFileStart]: MoveCursorToFileStartCommand,
	[EditorCommandType.MoveCursorToFileEnd]: MoveCursorToFileEndCommand,
	[EditorCommandType.MoveCursorToLineStart]: MoveCursorToLineStartCommand,
	[EditorCommandType.MoveCursorToLineEnd]: MoveCursorToLineEndCommand,
} satisfies Record<EditorCommandType, new () => IEditorCommand>));
