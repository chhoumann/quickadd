import { stripCursorMarkers } from "../../utils/capturePlacement";

const ASCII_WHITESPACE_ONLY_REGEX = /^[ \t\r\n\f\v]*$/;
const CURSOR_MARKER_REGEX = /\{\{CURSOR\}\}/i;

/**
 * Only ASCII whitespace counts as "nothing to capture". Unicode spaces such as
 * the non-breaking space (U+00A0) are intentional content and must not be
 * dropped, even though String.prototype.trim() strips them (issue #760).
 */
export function isCaptureContentEmpty(content: string): boolean {
	return ASCII_WHITESPACE_ONLY_REGEX.test(content);
}

export function hasCursorMarker(content: string): boolean {
	return CURSOR_MARKER_REGEX.test(content);
}

/** Capture text that holds a `{{CURSOR}}` marker and nothing else to write. */
export function isCursorMarkerOnly(content: string): boolean {
	return hasCursorMarker(content) && isCaptureContentEmpty(stripCursorMarkers(content));
}
