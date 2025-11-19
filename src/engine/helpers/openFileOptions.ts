import type { OpenFileOptions } from "../../types/fileOpening";
import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";

export function buildOpenFileOptions(
	command: IOpenFileCommand
): OpenFileOptions {
	const focus = command.focus ?? true;

	if (command.location) {
		switch (command.location) {
			case "reuse":
				return { location: "reuse", focus, mode: "default" };
			case "tab":
				return { location: "tab", focus, mode: "default" };
			case "split": {
				const direction =
					command.direction === "horizontal" || command.direction === "vertical"
						? command.direction
						: "vertical";
				return {
					location: "split",
					direction,
					focus,
					mode: "default",
				};
			}
			case "window":
				return { location: "window", focus, mode: "default" };
			case "left-sidebar":
				return { location: "left-sidebar", focus, mode: "default" };
			case "right-sidebar":
				return { location: "right-sidebar", focus, mode: "default" };
			default:
				break; // fall back to legacy fields
		}
	}

	const openInNewTab = command.openInNewTab ?? false;
	const legacyDirection =
		command.direction === "horizontal" || command.direction === "vertical"
			? command.direction
			: undefined;

	if (!openInNewTab) {
		return { location: "reuse", focus, mode: "default" };
	}

	if (!legacyDirection) {
		return { location: "tab", focus, mode: "default" };
	}

	return {
		location: "split",
		direction: legacyDirection,
		focus,
		mode: "default",
	};
}
