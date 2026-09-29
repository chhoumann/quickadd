import type { CapturePlacementResult } from "./capturePlacement";

/**
 * Answers, selections, clipboard text and picked field or file values are data.
 * After one is substituted, later format steps must not read a `{{token}}` or
 * a Templater `<% tag %>` written inside it.
 *
 * Every QuickAdd token starts with `{{` and every Templater tag with `<%`, so
 * a mark between those two characters hides them from both. `%>` is marked too,
 * so an answer inside a tag's string, as in `<% "{{VALUE:x}}".trim() %>`, cannot
 * close that tag early. The rest of the text is unchanged, so Templater still
 * gets the answer. The mark is U+FDD0, a Unicode noncharacter reserved for
 * internal use, and is removed before the text is written.
 */
const MARK = "\uFDD0";
const SYNTAX = /\{(?=\{)|<(?=%)|%(?=>)/g;
const MARKED_SYNTAX = /([{<%])\uFDD0(?=[{%>])/g;

export function protectUserText(text: string): string {
	return text.replace(SYNTAX, (char) => char + MARK);
}

export function restoreUserText(text: string): string {
	return text.includes(MARK) ? text.replace(MARKED_SYNTAX, "$1") : text;
}

/** Restores `content` and moves each offset into `content` to the same place in the result. */
export function restoreUserTextAt<T extends number | readonly number[]>(
	content: string,
	offsets: T,
): { content: string; offsets: T } {
	if (!content.includes(MARK)) return { content, offsets };
	const map = (offset: number) => restoreUserText(content.slice(0, offset)).length;
	return {
		content: restoreUserText(content),
		offsets: (typeof offsets === "number" ? map(offsets) : offsets.map(map)) as T,
	};
}

/** Restores a prepared capture payload, keeping its cursor on the same character. */
export function restoreUserTextInCapture(payload: CapturePlacementResult): CapturePlacementResult {
	const { cursor } = payload;
	const restored = restoreUserTextAt(payload.content, cursor.kind === "offset" ? cursor.value : 0);
	return {
		content: restored.content,
		cursor: cursor.kind === "offset" ? { ...cursor, value: restored.offsets } : cursor,
	};
}
