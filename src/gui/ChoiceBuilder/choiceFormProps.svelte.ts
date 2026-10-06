import type { App } from "obsidian";
import type QuickAdd from "../../main";
import { snapshot } from "../svelte/persist.svelte";
import type IChoice from "../../types/choices/IChoice";
import type { Step } from "../../v3/model";

export interface ChoiceFormProps<C extends IChoice> {
	choice: C;
	app: App;
	plugin: QuickAdd;
	/**
	 * Set by a form that holds input not yet in `choice` (the Template form's
	 * folder field): writes it into `choice`, leaving the form mounted.
	 */
	commitPending?: () => void;
	/**
	 * Adds a step after what the choice does, which makes it a sequence of
	 * steps. Absent where a choice cannot become one: a macro's step.
	 */
	onAddStep?: (step: Step) => void;
}

/** Detach live proxies and class instances before making the editable form state.
 * The host snapshots this choice on close; edits never write through to the source.
 */
export function createChoiceFormProps<C extends IChoice>(
	initial: ChoiceFormProps<C>,
): ChoiceFormProps<C> {
	// `commitPending` is declared so the form's binding can write it back:
	// Svelte only writes a bindable prop to a key the props object has.
	const props = $state({ ...initial, commitPending: undefined, choice: snapshot(initial.choice) });
	return props;
}
