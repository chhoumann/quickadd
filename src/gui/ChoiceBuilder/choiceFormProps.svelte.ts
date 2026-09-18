import type { App } from "obsidian";
import type QuickAdd from "../../main";
import { snapshot } from "../svelte/persist.svelte";
import type IChoice from "../../types/choices/IChoice";

export interface ChoiceFormProps<C extends IChoice> {
	choice: C;
	app: App;
	plugin: QuickAdd;
}

/** Detach live proxies and class instances before making the editable form state.
 * The host snapshots this choice on close; edits never write through to the source.
 */
export function createChoiceFormProps<C extends IChoice>(
	initial: ChoiceFormProps<C>,
): ChoiceFormProps<C> {
	const props = $state({ ...initial, choice: snapshot(initial.choice) });
	return props;
}
