const ASCII_WHITESPACE_ONLY_REGEX = /^[ \t\r\n\f\v]*$/;
const CURSOR_MARKER_REGEX = /\{\{CURSOR\}\}/i;
const CURSOR_MARKER_GLOBAL_REGEX = /\{\{CURSOR\}\}/gi;

export type CaptureCursor =
	| { readonly kind: "none" }
	| {
			readonly kind: "offset";
			readonly value: number;
			readonly source: "marker" | "defaultEnd";
	  };

export type CapturePlacementResult = Readonly<{
	content: string;
	cursor: CaptureCursor;
}>;

/**
 * Only ASCII whitespace counts as "nothing to capture". Unicode spaces such as
 * the non-breaking space (U+00A0) are intentional content and must not be
 * dropped, even though String.prototype.trim() strips them.
 */
export function isCaptureContentEmpty(content: string): boolean {
	return ASCII_WHITESPACE_ONLY_REGEX.test(content);
}

export function hasCursorMarker(content: string): boolean {
	return CURSOR_MARKER_REGEX.test(content);
}

export function stripCursorMarkers(content: string): string {
	return content.replace(CURSOR_MARKER_GLOBAL_REGEX, "");
}

export function isCursorMarkerOnly(content: string): boolean {
	return hasCursorMarker(content) && isCaptureContentEmpty(stripCursorMarkers(content));
}

export function prepareCapture(content: string): CapturePlacementResult {
	const marker = CURSOR_MARKER_REGEX.exec(content);
	content = stripCursorMarkers(content);
	return {
		content,
		cursor: isCaptureContentEmpty(content)
			? { kind: "none" }
			: {
					kind: "offset",
					value: marker?.index ?? content.length,
					source: marker ? "marker" : "defaultEnd",
			  },
	};
}

export function surroundCapture(
	payload: CapturePlacementResult,
	before: string,
	after = "",
): CapturePlacementResult {
	return {
		content: before + payload.content + after,
		cursor: payload.cursor.kind === "none"
			? payload.cursor
			: { ...payload.cursor, value: before.length + payload.cursor.value },
	};
}

export function placeCapture(
	payload: CapturePlacementResult,
	content: string,
	offset: number | null,
): CapturePlacementResult {
	return {
		content,
		cursor: payload.cursor.kind === "none" || offset === null
			? { kind: "none" }
			: { ...payload.cursor, value: offset },
	};
}
