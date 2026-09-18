import type { makeNoticeHandler } from "./makeNoticeHandler";

export async function trackPrompt<T>(
	promise: Promise<T>,
	notice: ReturnType<typeof makeNoticeHandler>,
	message: string[],
): Promise<T> {
	const started = Date.now();
	if (!(promise instanceof Promise)) {
		throw new TypeError("Promise must be an instance of Promise.");
	}
	let done = false;
	const finish = () => { done = true; };
	void promise.then(finish, finish);
	while (!done) {
		notice.setMessage(message[0], `${message[1]} (${((Date.now() - started) / 1000).toFixed(2)}s)`);
		await sleep(100);
	}
	notice.setMessage("finished", `Took ${((Date.now() - started) / 1000).toFixed(2)}s.`);
	return await promise;
}

export function outputVariables(name: string, output: string): Record<string, string> {
	return {
		[name]: output,
		[`${name}-quoted`]: ("> " + output).replace(/\n/g, "\n> "),
	};
}
