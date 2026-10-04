import type IChoice from "../types/choices/IChoice";

/**
 * The choices one run is nested in, outermost first, ending with the choice
 * that run is executing. Every run carries its own chain and hands it to the
 * runs it starts, so two runs started side by side on one executor never see
 * each other as ancestors.
 */
export type ChoiceChain = readonly IChoice[];

/**
 * Returns the chain for running `choice` inside `ancestry`, or throws when
 * `choice` is already in it, so a choice that reaches itself (a Choice or
 * NestedChoice step, a `{{MACRO:}}`, a script's `executeChoice`, or its own
 * registered command) fails with the cycle instead of recursing forever.
 */
export function enterChoice(choice: IChoice, ancestry: ChoiceChain): ChoiceChain {
	const start = ancestry.findIndex((c) => c.id === choice.id);
	if (start !== -1) {
		const cycle = [...ancestry.slice(start), choice]
			.map((c) => c.name)
			.join(" -> ");
		throw new Error(`${choice.type} "${choice.name}" calls itself: ${cycle}`);
	}
	return [...ancestry, choice];
}

/**
 * The chain of the run that is dispatching an Obsidian command, visible to
 * whatever that command starts. A registered QuickAdd command builds a fresh
 * ChoiceExecutor, so without this a macro step that runs its own
 * "QuickAdd: ..." command would recurse past the guard forever.
 * `executeCommandById` invokes the command synchronously, so the chain is set
 * only for that call and the new executor reads it in its constructor.
 */
let dispatchChain: ChoiceChain = [];

export function currentDispatchChain(): ChoiceChain {
	return dispatchChain;
}

export function withDispatchChain<T>(chain: ChoiceChain, run: () => T): T {
	const previous = dispatchChain;
	dispatchChain = chain;
	try {
		return run();
	} finally {
		dispatchChain = previous;
	}
}
