export type EditorCursorPlacement = Readonly<{
	offsets: readonly number[];
	content: string;
}>;

export type EditorTextMutation = Readonly<{
	filePath: string | null;
	before: string;
	after: string;
	edits: readonly Readonly<{ from: number; to: number; text: string }>[];
}>;

export type EditorTextMutationObserver = (mutation: EditorTextMutation) => void;

export function mapEditorCursorPlacement(
	cursor: EditorCursorPlacement,
	mutation: EditorTextMutation,
): EditorCursorPlacement | null {
	if (cursor.content !== mutation.before) return null;
	const edits = [...mutation.edits].sort((a, b) => a.from - b.from);
	let content = "";
	let end = 0;
	for (const edit of edits) {
		if (edit.from < end || edit.to < edit.from || edit.to > mutation.before.length) return null;
		content += mutation.before.slice(end, edit.from) + edit.text;
		end = edit.to;
	}
	content += mutation.before.slice(end);
	if (content !== mutation.after) return null;
	const offsets: number[] = [];
	for (const offset of cursor.offsets) {
		let delta = 0;
		for (const edit of edits) {
			const replacesText = edit.from !== edit.to;
			if (replacesText && edit.from <= offset && offset < edit.to) return null;
			if (edit.to < offset || (replacesText && edit.to === offset)) {
				delta += edit.text.length - (edit.to - edit.from);
			}
		}
		offsets.push(offset + delta);
	}
	return { offsets, content };
}
