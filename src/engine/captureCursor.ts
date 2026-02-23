export type CaptureCursorPosition = {
	line: number;
	ch: number;
};

export type CaptureInsertion = {
	boundaryOffsetInPrevious: number;
	cursorOffsetInNext: number;
	cursorPositionInNext: CaptureCursorPosition;
};

/**
 * Compute a cursor position for newly inserted capture content by diffing the
 * file content before and after capture.
 */
export function getCaptureCursorPosition(
	previousContent: string,
	nextContent: string,
): CaptureCursorPosition | null {
	const insertion = getCaptureInsertion(previousContent, nextContent);
	return insertion?.cursorPositionInNext ?? null;
}

export function getCaptureInsertion(
	previousContent: string,
	nextContent: string,
): CaptureInsertion | null {
	const insertedRange = getInsertedRange(previousContent, nextContent);
	if (!insertedRange) {
		return null;
	}

	const cursorOffset = getCursorOffset(
		nextContent,
		insertedRange.start,
		insertedRange.end,
	);

	return {
		boundaryOffsetInPrevious: insertedRange.start,
		cursorOffsetInNext: cursorOffset,
		cursorPositionInNext: toLineAndCh(nextContent, cursorOffset),
	};
}

export function mapCaptureCursorPositionFromBoundary(
	previousContent: string,
	nextContent: string,
	boundaryOffsetInPrevious: number,
): CaptureCursorPosition | null {
	const boundaryOffsetInNext = locateBoundaryOffset(
		previousContent,
		nextContent,
		boundaryOffsetInPrevious,
	);
	if (boundaryOffsetInNext === null) {
		return null;
	}

	const cursorOffset = getCursorOffset(
		nextContent,
		boundaryOffsetInNext,
		nextContent.length,
	);
	return toLineAndCh(nextContent, cursorOffset);
}

function getInsertedRange(
	previousContent: string,
	nextContent: string,
): { start: number; end: number; } | null {
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

	return { start: prefixLength, end: insertionEnd };
}

function getCursorOffset(
	content: string,
	startOffset: number,
	endOffset: number,
): number {
	let cursorOffset = Math.min(startOffset, content.length);
	const maxOffset = Math.min(endOffset, content.length);

	while (cursorOffset < maxOffset) {
		const char = content[cursorOffset];
		if (char !== "\n" && char !== "\r") {
			break;
		}
		cursorOffset++;
	}

	// The target segment may consist only of newlines; in that case use the
	// original boundary as the cursor anchor.
	if (cursorOffset >= maxOffset) {
		cursorOffset = Math.min(startOffset, content.length);
	}

	return cursorOffset;
}

function locateBoundaryOffset(
	previousContent: string,
	nextContent: string,
	boundaryOffsetInPrevious: number,
): number | null {
	const safeBoundary = Math.max(
		0,
		Math.min(boundaryOffsetInPrevious, previousContent.length),
	);
	const approxOffset =
		previousContent.length === 0
			? 0
			: Math.round((safeBoundary / previousContent.length) * nextContent.length);

	for (const windowSize of [80, 40, 20, 10, 5, 2, 1]) {
		const beforeContext = previousContent.slice(
			Math.max(0, safeBoundary - windowSize),
			safeBoundary,
		);
		const afterContext = previousContent.slice(
			safeBoundary,
			Math.min(previousContent.length, safeBoundary + windowSize),
		);

		const candidate = findBestBoundaryCandidate(
			nextContent,
			beforeContext,
			afterContext,
			approxOffset,
		);
		if (candidate !== null) {
			return candidate;
		}
	}

	return safeBoundary === 0 ? 0 : null;
}

function findBestBoundaryCandidate(
	content: string,
	beforeContext: string,
	afterContext: string,
	approxOffset: number,
): number | null {
	const candidateOffsets = collectCandidateOffsets(
		content,
		beforeContext,
		afterContext,
		approxOffset,
	);
	let bestOffset: number | null = null;
	let bestScore = Number.POSITIVE_INFINITY;

	for (const offset of candidateOffsets) {
		let score = Math.abs(offset - approxOffset);

		if (afterContext.length > 0) {
			const afterIndex = content.indexOf(afterContext, offset);
			if (afterIndex === -1) {
				continue;
			}

			score += Math.min(1000, Math.max(0, afterIndex - offset));
		}

		if (score < bestScore) {
			bestScore = score;
			bestOffset = offset;
		}
	}

	if (bestOffset !== null) {
		return bestOffset;
	}

	if (beforeContext.length === 0 && afterContext.length > 0) {
		const afterIndex = content.indexOf(afterContext);
		if (afterIndex !== -1) {
			return afterIndex;
		}
	}

	return null;
}

function collectCandidateOffsets(
	content: string,
	beforeContext: string,
	afterContext: string,
	approxOffset: number,
): number[] {
	if (beforeContext.length === 0) {
		if (afterContext.length === 0) {
			return [0];
		}

		const afterCandidates: number[] = [];
		let searchFrom = 0;
		while (searchFrom <= content.length) {
			const index = content.indexOf(afterContext, searchFrom);
			if (index === -1) {
				break;
			}

			afterCandidates.push(index);
			if (afterCandidates.length >= 64) {
				break;
			}
			searchFrom = index + 1;
		}

		if (afterCandidates.length > 0) {
			return afterCandidates
				.sort((a, b) => Math.abs(a - approxOffset) - Math.abs(b - approxOffset))
				.slice(0, 16);
		}

		return [0];
	}

	const candidates: number[] = [];
	let searchFrom = 0;
	while (searchFrom <= content.length) {
		const index = content.indexOf(beforeContext, searchFrom);
		if (index === -1) {
			break;
		}

		candidates.push(index + beforeContext.length);
		if (candidates.length >= 64) {
			break;
		}
		searchFrom = index + 1;
	}

	return candidates
		.sort((a, b) => Math.abs(a - approxOffset) - Math.abs(b - approxOffset))
		.slice(0, 16);
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
