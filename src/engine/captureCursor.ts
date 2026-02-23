export type CaptureCursorPosition = {
	line: number;
	ch: number;
};

/**
 * Compute a cursor position for newly inserted capture content by diffing the
 * file content before and after capture.
 */
export function getCaptureCursorPosition(
	previousContent: string,
	nextContent: string,
): CaptureCursorPosition | null {
	if (previousContent === nextContent) {
		return null;
	}

	const minLength = Math.min(previousContent.length, nextContent.length);
	let prefixLength = 0;
	while (
		prefixLength < minLength &&
		previousContent.charCodeAt(prefixLength) ===
			nextContent.charCodeAt(prefixLength)
	) {
		prefixLength++;
	}

	let previousIndex = previousContent.length - 1;
	let nextIndex = nextContent.length - 1;
	while (
		previousIndex >= prefixLength &&
		nextIndex >= prefixLength &&
		previousContent.charCodeAt(previousIndex) ===
			nextContent.charCodeAt(nextIndex)
	) {
		previousIndex--;
		nextIndex--;
	}

	const insertionEnd = nextIndex + 1;
	if (insertionEnd <= prefixLength) {
		return null;
	}

	let cursorOffset = prefixLength;
	while (cursorOffset < insertionEnd) {
		const char = nextContent[cursorOffset];
		if (char !== "\n" && char !== "\r") {
			break;
		}
		cursorOffset++;
	}

	// The inserted segment may consist only of newlines; in that case use the
	// insertion boundary as the cursor anchor.
	if (cursorOffset >= insertionEnd) {
		cursorOffset = prefixLength;
	}

	return toLineAndCh(nextContent, cursorOffset);
}

function toLineAndCh(content: string, offset: number): CaptureCursorPosition {
	let line = 0;
	let ch = 0;
	const cappedOffset = Math.min(offset, content.length);

	for (let i = 0; i < cappedOffset; i++) {
		const char = content[i];
		if (char === "\n") {
			line++;
			ch = 0;
			continue;
		}

		if (char !== "\r") {
			ch++;
		}
	}

	return { line, ch };
}
