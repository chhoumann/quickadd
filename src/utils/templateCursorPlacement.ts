import { stripCursorMarkers } from "../formatters/helpers/capturePlacement";
import type { EditorCursorPlacement } from "./editorCursorPlacement";
import { getBodyStartOffset } from "./noteContentInsertion";

export function prepareTemplateContent(content: string): EditorCursorPlacement {
	const bodyStart = getBodyStartOffset(content);
	const marker = /\{\{CURSOR\}\}/i.exec(content.slice(bodyStart));
	return {
		content: stripCursorMarkers(content),
		offsets: marker
			? [stripCursorMarkers(content.slice(0, bodyStart)).length + marker.index]
			: [],
	};
}

export function rebaseTemplateCursor(
	cursor: EditorCursorPlacement,
	content: string,
): EditorCursorPlacement | null {
	if (cursor.content === content) return cursor;
	const beforeStart = getBodyStartOffset(cursor.content);
	const afterStart = getBodyStartOffset(content);
	if (cursor.offsets.some(offset => offset < beforeStart) ||
		cursor.content.slice(beforeStart) !== content.slice(afterStart)) return null;
	return {
		content,
		offsets: cursor.offsets.map(offset => offset + afterStart - beforeStart),
	};
}
