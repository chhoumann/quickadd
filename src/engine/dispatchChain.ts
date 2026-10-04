import type IChoice from "../types/choices/IChoice";

/**
 * The choices running in the executor that is dispatching an Obsidian command,
 * visible to whatever that command starts. A registered QuickAdd command
 * builds a fresh ChoiceExecutor, so without this a macro step that runs its own
 * "QuickAdd: ..." command would recurse past the re-entry guard forever.
 * `executeCommandById` invokes the command synchronously, so the chain is set
 * only for that call and the new executor reads it in its constructor.
 */
let dispatchChain: readonly IChoice[] = [];

export function currentDispatchChain(): readonly IChoice[] {
	return dispatchChain;
}

export function withDispatchChain<T>(chain: readonly IChoice[], run: () => T): T {
	const previous = dispatchChain;
	dispatchChain = chain;
	try {
		return run();
	} finally {
		dispatchChain = previous;
	}
}
