import type { OpenFileOptions } from "../../types/fileOpening";
import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";

function getSplitDirection(
	direction: IOpenFileCommand["direction"],
	fallback: "vertical" | undefined = undefined
): "horizontal" | "vertical" | undefined {
	return direction === "horizontal" || direction === "vertical"
		? direction
		: fallback;
}

function createOpenFileOptions(
	location: NonNullable<OpenFileOptions["location"]>,
	focus: boolean,
	direction?: OpenFileOptions["direction"]
): OpenFileOptions {
	return direction
		? { location, direction, focus, mode: "default" }
		: { location, focus, mode: "default" };
}

export function buildOpenFileOptions(
	command: IOpenFileCommand
): OpenFileOptions {
	const focus = command.focus ?? true;

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
					getSplitDirection(command.direction, "vertical")
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

	return createOpenFileOptions("split", focus, legacyDirection ?? "vertical");
}
