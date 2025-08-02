import { CommandType } from "../CommandType";
import { nanoid } from "nanoid";
import type { IOpenFileCommand } from "./IOpenFileCommand";
import type { NewTabDirection } from "../../newTabDirection";

export class OpenFileCommand implements IOpenFileCommand {
	readonly type = CommandType.OpenFile;
	id = nanoid();
	name: string;
	
	constructor(
		public filePath = "{{DATE}}.md",
		public openInNewTab = false,
		public direction?: NewTabDirection
	) {
		this.name = `Open file: ${this.filePath}`;
	}
}
