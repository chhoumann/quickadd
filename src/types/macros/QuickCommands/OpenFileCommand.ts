import { CommandType } from "../CommandType";
import { nanoid } from "nanoid";
import type { IOpenFileCommand } from "./IOpenFileCommand";
import type { NewTabDirection } from "../../newTabDirection";
import type { OpenLocation } from "../../fileOpening";

export class OpenFileCommand implements IOpenFileCommand {
	readonly type = CommandType.OpenFile;
	id = nanoid();
	name: string;
	location?: OpenLocation;
	focus?: boolean;
	openInNewTab: boolean;
	direction?: NewTabDirection;

	constructor(
		public filePath = "{{DATE}}.md",
		openInNewTab = false,
		direction?: NewTabDirection,
		location?: OpenLocation,
		focus = true
	) {
		this.openInNewTab = openInNewTab;
		this.direction = direction;
		this.location = location ?? this.deriveLocation(openInNewTab, direction);
		this.focus = focus;
		this.name = `Open file: ${this.filePath}`;
	}

	private deriveLocation(
		openInNewTab: boolean,
		direction?: NewTabDirection
	): OpenLocation {
		if (!openInNewTab) return "reuse";
		if (direction) return "split";
		return "tab";
	}
}
