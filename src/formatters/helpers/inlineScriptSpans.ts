const INLINE_SCRIPT_FENCE_LANG = "js quickadd";

export type InlineScriptSpan = { start: number; end: number; code: string };

/**
 * The first complete ```js quickadd fence at or after `from`, with its trimmed
 * code. A fence opens with 3+ backticks and the language, and closes at the
 * next run of 3+ backticks, which it consumes whole. `from` must not fall
 * inside a backtick run. The scan is linear; a regex for the same grammar
 * backtracks on long backtick runs and freezes the app (#1907).
 */
export function findNextInlineScript(
	input: string,
	from = 0,
): InlineScriptSpan | undefined {
	const n = input.length;
	let i = from;

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
		while (j < n) {
			const tick = input.indexOf("`", j);
			if (tick === -1) break;
			let tickRunEnd = tick;
			while (tickRunEnd < n && input[tickRunEnd] === "`") tickRunEnd++;
			if (tickRunEnd - tick >= 3) {
				return {
					start: runStart,
					end: tickRunEnd,
					code: input.slice(codeStart, tick).trim(),
				};
			}
			j = tickRunEnd;
		}
		break;
	}

	return undefined;
}

export function findInlineScriptSpans(input: string): InlineScriptSpan[] {
	const spans: InlineScriptSpan[] = [];
	let span = findNextInlineScript(input);
	while (span) {
		spans.push(span);
		span = findNextInlineScript(input, span.end);
	}
	return spans;
}

/**
 * Where to resume findNextInlineScript after the fence at `start` was replaced.
 * No fence opened before `start`, but its last few characters can open one
 * together with the replacement, as in "```js quick" followed by "add".
 */
export function inlineScriptRescanFrom(input: string, start: number): number {
	const firstLangStart = Math.max(3, start - INLINE_SCRIPT_FENCE_LANG.length + 1);
	for (let langStart = firstLangStart; langStart < start; langStart++) {
		if (
			input.startsWith("```", langStart - 3) &&
			input.startsWith(INLINE_SCRIPT_FENCE_LANG, langStart)
		) {
			let runStart = langStart - 3;
			while (runStart > 0 && input[runStart - 1] === "`") runStart--;
			return runStart;
		}
	}
	return start;
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
