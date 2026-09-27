/**
 * Run `run` and return every promise rejection it left unhandled, instead of letting
 * vitest fail the file on them.
 *
 * Node's `unhandledRejection` and the browser's `unhandledrejection` (which is what
 * Obsidian's `dev:errors` records) come from the same V8 bookkeeping, so an empty
 * result means nothing would have reached `dev:errors`.
 */
export async function collectUnhandledRejections(
	run: () => unknown,
): Promise<unknown[]> {
	const seen: unknown[] = [];
	const collect = (reason: unknown) => {
		seen.push(reason);
	};
	// Vitest's own listener would report these as failures of the whole run, so it
	// is set aside while `run` executes and restored afterwards.
	const previous = process.rawListeners("unhandledRejection");
	process.removeAllListeners("unhandledRejection");
	process.on("unhandledRejection", collect);
	try {
		await run();
		// Node classifies rejections once the microtask queue drains; a macrotask
		// later, everything `run` left behind has been reported.
		await new Promise((resolve) => setTimeout(resolve, 10));
	} finally {
		process.off("unhandledRejection", collect);
		for (const listener of previous) {
			process.on("unhandledRejection", listener as (...args: unknown[]) => void);
		}
	}
	return seen;
}
