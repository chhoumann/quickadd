import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";

/**
 * Props for CaptureChoiceForm, shared with its imperative host
 * (CaptureChoiceBuilder). The host owns the returned $state-backed instance and
 * the FORM mutates `props.choice` (a $state proxy). At modal close the host
 * snapshots `props.choice` — NOT the original `this.choice`, which a $state
 * proxy does not write through to (see persist.svelte.ts / issue #1130).
 */
export interface CaptureChoiceFormProps {
	choice: ICaptureChoice;
	app: App;
	plugin: QuickAdd;
}

export function createCaptureChoiceFormProps(
	initial: CaptureChoiceFormProps,
): CaptureChoiceFormProps {
	// Detach the choice into a plain clone so $state can deeply proxy it, mutated by
	// the form and snapshotted back out by onClose (getResultChoice). #1130
	//
	// Why $state.snapshot and NOT structuredClone:
	//  - EXISTING choice: can arrive as a live $state proxy (a Macro's nested
	//    command.choice is reactive — see CommandList.svelte). structuredClone throws
	//    DataCloneError on a $state proxy under Svelte's dev build; $state.snapshot
	//    detaches it via Svelte's own deep clone. This is the Plain<T> proxy-detach
	//    rule from persist.svelte.ts.
	//  - NEW choice: createChoice() returns a `new CaptureChoice()` class instance,
	//    which $state() leaves UN-proxied — it must be plain for nested {#if} rows to
	//    react. snapshot deep-clones it too: a Choice is plain data, so Svelte's clone
	//    delegates the cloneable instance to structuredClone, stripping the prototype
	//    to Object.prototype. (Verified by the add-new reactivity test in
	//    CaptureChoiceForm.test.ts and choiceFormProps.proxy.svelte.test.ts.)
	const props = $state({ ...initial, choice: $state.snapshot(initial.choice) });
	return props;
}
