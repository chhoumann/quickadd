import type { NoticeHandler } from "./makeNoticeHandler";

/** How often the running notice's elapsed time refreshes. */
const PROGRESS_TICK_MS = 100;

/**
 * Show `message` with a running elapsed time until `promise` settles, then
 * finish the notice on success. A failure is left to the caller's
 * `notice.fail`, which reports it.
 */
export async function trackPrompt<T>(
	promise: Promise<T>,
	notice: NoticeHandler,
	[status, message]: [string, string],
): Promise<T> {
	const started = Date.now();
	const elapsed = () => `${((Date.now() - started) / 1000).toFixed(2)}s`;
	const tick = () => notice.setMessage(status, `${message} (${elapsed()})`);
	tick();
	const timer = window.setInterval(tick, PROGRESS_TICK_MS);
	let result: T;
	try {
		result = await promise;
	} finally {
		window.clearInterval(timer);
	}
	notice.finish(`Took ${elapsed()}.`);
	return result;
}

/** A prompt's output as `{{VALUE:name}}` and its blockquoted `{{VALUE:name-quoted}}` twin. */
export function outputVariables(name: string, output: string): Record<string, string> {
	return {
		[name]: output,
		[`${name}-quoted`]: blockquote(output),
	};
}

function blockquote(text: string): string {
	return ("> " + text).replace(/\n/g, "\n> ");
}
