const INLINE_SCRIPT_FENCE_LANG = "js quickadd";

/**
 * Finds each complete ```js quickadd fence and its trimmed code. A fence opens
 * with 3+ backticks and the language, and closes at the next run of 3+
 * backticks, which it consumes whole. The scan is linear; a regex for the same
 * grammar backtracks on long backtick runs and freezes the app (#1907).
 */
export function findInlineScriptSpans(
	input: string,
): Array<{ start: number; end: number; code: string }> {
	const spans: Array<{ start: number; end: number; code: string }> = [];
	const n = input.length;
	let i = 0;

	while (i < n) {
		const runStart = input.indexOf("`", i);
		if (runStart === -1) break;
		let runEnd = runStart;
		while (runEnd < n && input[runEnd] === "`") runEnd++;

		if (
			runEnd - runStart < 3 ||
			!input.startsWith(INLINE_SCRIPT_FENCE_LANG, runEnd)
		) {
			i = runEnd;
			continue;
		}

		// Opener found — the next 3+ backtick run closes it. If none exists,
		// no later opener can match either (its backticks would have served
		// as this fence's closer), so scanning is done.
		const codeStart = runEnd + INLINE_SCRIPT_FENCE_LANG.length;
		let j = codeStart;
		let codeEnd = -1;
		let end = -1;
		while (j < n) {
			const tick = input.indexOf("`", j);
			if (tick === -1) break;
			let tickRunEnd = tick;
			while (tickRunEnd < n && input[tickRunEnd] === "`") tickRunEnd++;
			if (tickRunEnd - tick >= 3) {
				codeEnd = tick;
				end = tickRunEnd;
				break;
			}
			j = tickRunEnd;
		}
		if (end === -1) break;

		spans.push({ start: runStart, end, code: input.slice(codeStart, codeEnd).trim() });
		i = end;
	}

	return spans;
}

/** Ignore complete fences, then check whether the remaining text opened one without closing it. */
export function hasUnterminatedInlineScriptFence(input: string): boolean {
	const spans = findInlineScriptSpans(input);
	const n = input.length;
	let i = spans.length > 0 ? spans[spans.length - 1].end : 0;

	while (i < n) {
		const runStart = input.indexOf("`", i);
		if (runStart === -1) return false;
		let runEnd = runStart;
		while (runEnd < n && input[runEnd] === "`") runEnd++;

		if (
			runEnd - runStart >= 3 &&
			input.startsWith(INLINE_SCRIPT_FENCE_LANG, runEnd)
		) {
			return true;
		}
		i = runEnd;
	}
	return false;
}

/**
 * The code of each complete ```js quickadd fence, trimmed. Empty fences are left
 * out: the formatter consumes them without running anything.
 */
export function inlineScriptBodies(input: string): string[] {
	return findInlineScriptSpans(input)
		.map(({ code }) => code)
		.filter((code) => code !== "");
}
