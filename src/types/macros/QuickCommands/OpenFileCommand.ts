import { CommandType } from "../CommandType";
import { nanoid } from "nanoid";
import type { IOpenFileCommand } from "./IOpenFileCommand";
import type { NewTabDirection } from "../../newTabDirection";
import type { FileViewMode } from "../../fileViewMode";

export class OpenFileCommand implements IOpenFileCommand {
	readonly type = CommandType.OpenFile;
	id = nanoid();
	name: string;
	
	constructor(
		public filePath = "{{DATE}}todo.md",
		public openInNewTab = false,
		public direction?: NewTabDirection,
		public focus = true,
		public mode?: FileViewMode
	) {
		this.name = `Open file: ${this.filePath}`;
	}
}
