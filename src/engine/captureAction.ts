import type ICaptureChoice from "../types/choices/ICaptureChoice";

export type CaptureAction = "top" | "bottom" | "insertAfter" | "insertBefore" | "currentLine" | "newLineAbove" | "newLineBelow" | "activeFileTop";

/**
 * Where a Capture writes. This is the one precedence every caller follows: the
 * engine (editor insertion, notices, canvas checks), the formatter's placement,
 * and the builder's Write position dropdown. It also decides flag combinations
 * the builder never produces (a hand-edited or imported choice):
 *
 * - On the active file without a line target, the cursor-side settings win: a
 *   new-line capture, then the active-file position, then legacy `prepend`
 *   (which always meant the bottom).
 * - Everywhere else a bottom write beats a line target, and insert-after beats
 *   insert-before.
 */
export function getCaptureAction(choice: ICaptureChoice): CaptureAction {
	const lineTarget = !!choice.insertAfter?.enabled || !!choice.insertBefore?.enabled;
	if (choice.captureToActiveFile && !lineTarget) {
		if (choice.newLineCapture?.enabled)
			return choice.newLineCapture.direction === "above" ? "newLineAbove" : "newLineBelow";
		if (choice.activeFileWritePosition === "top") return "activeFileTop";
		if (choice.activeFileWritePosition === "bottom" || choice.prepend) return "bottom";
		return "currentLine";
	}
	if (choice.prepend || (choice.captureToActiveFile && choice.activeFileWritePosition === "bottom")) return "bottom";
	if (choice.insertAfter?.enabled) return "insertAfter";
	if (choice.insertBefore?.enabled) return "insertBefore";
	return "top";
}

type WritePosition =
	| "property"
	| "after"
	| "before"
	| "newLineAbove"
	| "newLineBelow"
	| "activeTop"
	| "bottom"
	| "top";

const WRITE_POSITION: Record<CaptureAction, WritePosition> = {
	top: "top",
	bottom: "bottom",
	insertAfter: "after",
	insertBefore: "before",
	currentLine: "top",
	newLineAbove: "newLineAbove",
	newLineBelow: "newLineBelow",
	activeFileTop: "activeTop",
};

/**
 * Where a Capture writes, for the choice builder's Write position dropdown and
 * `quickadd:list`. `top` means the top of the target file, or the cursor when
 * capturing to the active file.
 */
export function getWritePosition(choice: ICaptureChoice): WritePosition {
	if (choice.propertyCapture) return "property";
	return WRITE_POSITION[getCaptureAction(choice)];
}

/** Actions that write through the current note's editor at its cursor. */
export function isEditorAction(action: CaptureAction): boolean {
	return action === "currentLine" || action === "newLineAbove" || action === "newLineBelow";
}

/**
 * The choice with its cursor position replaced by the position its other
 * settings give: the bottom when it captures to the bottom, else the top. Used
 * when no active editor shows the current note (a run that named it with
 * `current=`), so the capture is written through the vault instead of failing.
 */
export function withoutCursorPosition(choice: ICaptureChoice): ICaptureChoice {
	return {
		...choice,
		activeFileWritePosition:
			choice.prepend || choice.activeFileWritePosition === "bottom" ? "bottom" : "top",
		newLineCapture: { ...choice.newLineCapture, enabled: false },
	};
}

/** Whether a Capture's selected text answers its {{VALUE}}: its own setting, else the global one, on by default. */
export function usesSelectionAsCaptureValue(
	choice: Pick<ICaptureChoice, "useSelectionAsCaptureValue">,
	settings: { useSelectionAsCaptureValue?: boolean },
): boolean {
	return typeof choice.useSelectionAsCaptureValue === "boolean"
		? choice.useSelectionAsCaptureValue
		: settings.useSelectionAsCaptureValue ?? true;
}
