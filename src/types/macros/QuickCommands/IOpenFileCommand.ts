import type { ICommand } from "../ICommand";
import type { NewTabDirection } from "../../newTabDirection";
import type { OpenLocation } from "../../fileOpening";

export interface IOpenFileCommand extends ICommand {
	/** File path with optional formatting like "{{DATE}}todo.md" */
	filePath: string;

	/** Open file options */
	openInNewTab?: boolean;
	direction?: NewTabDirection;
	location?: OpenLocation;
	focus?: boolean;
}
