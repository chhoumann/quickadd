import type { OpenFileOptions } from "../../types/fileOpening";
import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";
import { NewTabDirection } from "../../types/newTabDirection";
import { DEFAULT_FILE_OPENING } from "../../utils/fileOpeningDefaults";

function getSplitDirection(
	direction: IOpenFileCommand["direction"],
	fallback: "horizontal" | "vertical" | undefined = undefined
): "horizontal" | "vertical" | undefined {
	if (direction === NewTabDirection.horizontal) return "horizontal";
	if (direction === NewTabDirection.vertical) return "vertical";
	return fallback;
}

function createOpenFileOptions(
	location: NonNullable<OpenFileOptions["location"]>,
	focus: boolean,
	direction?: OpenFileOptions["direction"]
): OpenFileOptions {
	return direction
		? { location, direction, focus, mode: DEFAULT_FILE_OPENING.mode }
		: { location, focus, mode: DEFAULT_FILE_OPENING.mode };
}

export function buildOpenFileOptions(
	command: IOpenFileCommand
): OpenFileOptions {
	const focus = command.focus ?? DEFAULT_FILE_OPENING.focus;

	if (command.location) {
		switch (command.location) {
			case "reuse":
				return createOpenFileOptions("reuse", focus);
			case "tab":
				return createOpenFileOptions("tab", focus);
			case "split": {
				return createOpenFileOptions(
					"split",
					focus,
					getSplitDirection(command.direction, DEFAULT_FILE_OPENING.direction)
				);
			}
			case "window":
				return createOpenFileOptions("window", focus);
			case "left-sidebar":
				return createOpenFileOptions("left-sidebar", focus);
			case "right-sidebar":
				return createOpenFileOptions("right-sidebar", focus);
			default:
				break; // fall back to legacy fields
		}
	}

	const openInNewTab = command.openInNewTab ?? false;
	const legacyDirection = getSplitDirection(command.direction);

	// Legacy mapping (pre-location field):
	// openInNewTab === false -> reuse the current tab
	// openInNewTab === true without direction -> split (default vertical)
	if (!openInNewTab) {
		return createOpenFileOptions("reuse", focus);
	}

	return createOpenFileOptions("split", focus, legacyDirection ?? DEFAULT_FILE_OPENING.direction);
}
