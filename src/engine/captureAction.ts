import type ICaptureChoice from "../types/choices/ICaptureChoice";

export type CaptureAction = "append" | "prepend" | "insertAfter" | "currentLine" | "newLineAbove" | "newLineBelow" | "activeFileTop";

/**
 * Gets the capture action based on choice configuration.
 * Uses explicit if/else logic instead of nested ternary for clarity.
 */
export function getCaptureAction(choice: ICaptureChoice): CaptureAction {
	if (choice.captureToActiveFile && choice.newLineCapture?.enabled) {
		return choice.newLineCapture.direction === "above" ? "newLineAbove" : "newLineBelow";
	}

	if (choice.captureToActiveFile && !choice.prepend && !choice.insertAfter.enabled) {
		if (choice.activeFileWritePosition === "top") {
			return "activeFileTop";
		}

		return "currentLine";
	}

	if (choice.insertAfter.enabled) {
		return "insertAfter";
	}

	if (choice.prepend) {
		return "prepend";
	}

	return "append";
}
