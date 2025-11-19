import { CommandType } from "../CommandType";
import { nanoid } from "nanoid";
import type { IOpenFileCommand } from "./IOpenFileCommand";
import { NewTabDirection } from "../../newTabDirection";
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
		this.location = location;
		this.focus = focus;
		this.name = `Open file: ${this.filePath}`;

		// Keep legacy flags in sync for backward compatibility (older builds read them).
		this.applyLegacyFromLocation();
	}

	private applyLegacyFromLocation() {
		if (!this.location) return;

		switch (this.location) {
			case "split":
				this.openInNewTab = true;
				if (!this.direction) this.direction = NewTabDirection.vertical;
				break;
			case "tab":
			case "reuse":
				this.openInNewTab = false;
				this.direction = undefined;
				break;
			default:
				// window / sidebars → treat as opening new context
				this.openInNewTab = true;
				this.direction = undefined;
				break;
		}
	}
}
