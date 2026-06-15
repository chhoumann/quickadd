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
	// Detach the choice into a plain clone so $state can deeply proxy it. Svelte's
	// proxy() returns class instances UNCHANGED (un-proxied) — newly created choices
	// come from `createChoice()` as `new CaptureChoice()` instances, whose nested
	// mutations would then NOT be reactive (conditional {#if} rows wouldn't appear in
	// the add-new flow). $state.snapshot strips the class prototype to a plain object;
	// the form mutates this proxy and onClose snapshots it (getResultChoice). #1130
	//
	// Use $state.snapshot, NOT structuredClone: an EXISTING choice arrives here as a
	// live $state proxy (ChoiceView holds saved choices, loaded from data.json as
	// plain objects, in a $state array). structuredClone throws DataCloneError on a
	// $state proxy; $state.snapshot detaches it (see the Plain<T> rule in
	// persist.svelte.ts). New choices are class instances (un-proxied) and snapshot
	// strips their prototype just the same.
	const props = $state({ ...initial, choice: $state.snapshot(initial.choice) });
	return props;
}
