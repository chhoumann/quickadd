/** Replace `[start, end)` of `text` with `inserted`; the cursor lands after it. */
export function replaceRange(
	text: string,
	start: number,
	end: number,
	inserted: string,
): { text: string; cursor: number } {
	const from = Math.max(0, Math.min(start, text.length));
	const to = Math.max(from, Math.min(end, text.length));
	return {
		text: text.slice(0, from) + inserted + text.slice(to),
		cursor: from + inserted.length,
	};
}

export function previewSelection(selection: string, maxLength = 42): string {
	// Window before the regex so a huge selection is never scanned whole.
	const windowed = selection.slice(0, maxLength * 4);
	const collapsed = windowed.replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxLength) {
		return windowed.length < selection.length ? `${collapsed}…` : collapsed;
	}
	return `${collapsed.slice(0, Math.max(0, maxLength - 1))}…`;
}
