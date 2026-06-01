import type ICaptureChoice from "../types/choices/ICaptureChoice";

export type CaptureAction = "append" | "prepend" | "insertAfter" | "insertBefore" | "currentLine" | "newLineAbove" | "newLineBelow" | "activeFileTop";

/**
 * Gets the capture action based on choice configuration.
 * Uses explicit if/else logic instead of nested ternary for clarity.
 */
export function getCaptureAction(choice: ICaptureChoice): CaptureAction {
	const lineTargetCaptureEnabled =
		choice.insertAfter.enabled || !!choice.insertBefore?.enabled;

	if (choice.captureToActiveFile && !lineTargetCaptureEnabled && choice.newLineCapture?.enabled) {
		return choice.newLineCapture.direction === "above" ? "newLineAbove" : "newLineBelow";
	}

	if (choice.captureToActiveFile && !lineTargetCaptureEnabled) {
		if (choice.activeFileWritePosition === "top") {
			return "activeFileTop";
		}

		if (choice.activeFileWritePosition === "bottom") {
			return "append";
		}

		if (choice.prepend) {
			return "append";
		}

		return "currentLine";
	}

	if (choice.insertAfter.enabled) {
		return "insertAfter";
	}

	if (choice.insertBefore?.enabled) {
		return "insertBefore";
	}

	if (choice.prepend) {
		return "prepend";
	}

	return "append";
}
