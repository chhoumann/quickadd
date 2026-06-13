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
	const props = $state(initial);
	return props;
}
