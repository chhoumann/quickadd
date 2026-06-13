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
	// Plain-clone the choice so $state deeply proxies it. Svelte's proxy() returns
	// class instances UNCHANGED (un-proxied) — newly created choices come from
	// `createChoice()` as `new CaptureChoice()` instances, whose nested mutations
	// would then NOT be reactive (conditional {#if} rows wouldn't appear in the
	// add-new flow). structuredClone strips the class prototype to a plain object;
	// the form mutates this proxy and onClose snapshots it (getResultChoice). #1130
	const props = $state({ ...initial, choice: structuredClone(initial.choice) });
	return props;
}
