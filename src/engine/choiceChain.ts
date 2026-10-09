import type { TFile } from "obsidian";
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
 * What the run dispatching an Obsidian command hands to whatever that command
 * starts. A registered QuickAdd command builds a fresh ChoiceExecutor, so
 * without the chain a macro step that runs its own "QuickAdd: ..." command
 * would recurse past the guard forever, and without the note a choice run that
 * way would read the active tab instead of the note named with `current=`.
 * `executeCommandById` invokes the command synchronously, so the dispatch is
 * set only for that call and the new executor reads it in its constructor.
 */
export interface Dispatch {
	chain: ChoiceChain;
	/** The note the dispatching run's caller named with `current=` (`null` for `current=none`); absent when it named no note. */
	currentNote?: TFile | null;
}

let dispatch: Dispatch = { chain: [] };

export function currentDispatch(): Dispatch {
	return dispatch;
}

export function withDispatch<T>(next: Dispatch, run: () => T): T {
	const previous = dispatch;
	dispatch = next;
	try {
		return run();
	} finally {
		dispatch = previous;
	}
}
