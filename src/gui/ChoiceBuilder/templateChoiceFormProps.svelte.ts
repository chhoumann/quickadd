import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";

/**
 * Props for TemplateChoiceForm, shared with its imperative host
 * (TemplateChoiceBuilder). The host owns the returned $state-backed instance and
 * the FORM mutates `props.choice` (a $state proxy). At modal close the host
 * snapshots `props.choice` — NOT the original `this.choice`, which a $state
 * proxy does not write through to (see persist.svelte.ts / issue #1130).
 */
export interface TemplateChoiceFormProps {
	choice: ITemplateChoice;
	app: App;
	plugin: QuickAdd;
}

export function createTemplateChoiceFormProps(
	initial: TemplateChoiceFormProps,
): TemplateChoiceFormProps {
	// Detach the choice into a plain clone so $state can deeply proxy it, mutated by
	// the form and snapshotted back out by onClose (getResultChoice). #1130
	//
	// Why $state.snapshot and NOT structuredClone:
	//  - EXISTING choice: can arrive as a live $state proxy. A choice nested inside a
	//    folder (Multi) or a Macro is held/rendered through $state (ChoiceList's
	//    dndzone / CommandList), so it is reactive — only ROOT-level choices stay
	//    plain. structuredClone throws DataCloneError on a $state proxy under Svelte's
	//    dev build; $state.snapshot detaches it via Svelte's own deep clone. This is
	//    the Plain<T> proxy-detach rule from persist.svelte.ts.
	//  - NEW choice: createChoice() returns a `new TemplateChoice()` class instance,
	//    which $state() leaves UN-proxied — it must be plain for nested {#if} rows to
	//    react. snapshot deep-clones it too: a Choice is plain data, so Svelte's clone
	//    delegates the cloneable instance to structuredClone, stripping the prototype
	//    to Object.prototype. (Verified by the add-new reactivity test in
	//    CaptureChoiceForm.test.ts and choiceFormProps.proxy.svelte.test.ts.)
	const props = $state({ ...initial, choice: $state.snapshot(initial.choice) });
	return props;
}
