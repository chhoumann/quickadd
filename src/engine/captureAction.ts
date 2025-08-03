import type ICaptureChoice from "../types/choices/ICaptureChoice";

export type CaptureAction = "append" | "prepend" | "insertAfter" | "currentLine";

/**
 * Gets the capture action based on choice configuration.
 * Uses explicit if/else logic instead of nested ternary for clarity.
 */
export function getCaptureAction(choice: ICaptureChoice): CaptureAction {
	if (choice.captureToActiveFile && !choice.prepend && !choice.insertAfter.enabled) {
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
