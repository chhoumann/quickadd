const INLINE_SCRIPT_FENCE_LANG = "js quickadd";

/** Linear fence scan matching INLINE_JAVASCRIPT_REGEX without backtracking on backtick floods. */
export function findInlineScriptSpans(
	input: string,
): Array<{ start: number; end: number }> {
	const spans: Array<{ start: number; end: number }> = [];
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
		let j = runEnd + INLINE_SCRIPT_FENCE_LANG.length;
		let end = -1;
		while (j < n) {
			const tick = input.indexOf("`", j);
			if (tick === -1) break;
			let tickRunEnd = tick;
			while (tickRunEnd < n && input[tickRunEnd] === "`") tickRunEnd++;
			if (tickRunEnd - tick >= 3) {
				end = tickRunEnd;
				break;
			}
			j = tickRunEnd;
		}
		if (end === -1) break;

		spans.push({ start: runStart, end });
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
