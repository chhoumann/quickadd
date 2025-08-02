import type { ICommand } from "../ICommand";
import type { NewTabDirection } from "../../newTabDirection";
import type { FileViewMode } from "../../fileViewMode";

export interface IOpenFileCommand extends ICommand {
	/** File path with optional formatting like "{{DATE}}todo.md" */
	filePath: string;

	/** Open file options */
	openInNewTab?: boolean;
	direction?: NewTabDirection;
	focus?: boolean;
	mode?: FileViewMode;
}
