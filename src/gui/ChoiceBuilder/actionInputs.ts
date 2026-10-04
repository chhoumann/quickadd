import { settingsStore } from "../../settingsStore";
import type { Action, InputOverride } from "../../v3/model";
import { findAction } from "../../v3/storage";
import { changeAction, isOwnAction } from "./actionRibbon";

/** The overrides the action a choice stands for holds. Null when the choice is not an action of its own. */
export function actionInputOverrides(choiceId: string): Record<string, InputOverride> | null {
	if (!isOwnAction(choiceId)) return null;
	return findAction(settingsStore.getState().actions, choiceId)?.inputs ?? {};
}

/** Sets what `change` names of an input's override; undefined takes it back to the placeholder's own. */
export function setActionInputOverride(choiceId: string, name: string, change: Partial<InputOverride>): void {
	changeAction(choiceId, (action) => {
		const override: InputOverride = { ...action.inputs?.[name], ...change };
		for (const key of Object.keys(override) as (keyof InputOverride)[]) {
			if (override[key] === undefined) delete override[key];
		}
		const inputs = { ...action.inputs };
		if (Object.keys(override).length > 0) inputs[name] = override;
		else delete inputs[name];
		const next: Action = { ...action, inputs };
		if (Object.keys(inputs).length === 0) delete next.inputs;
		return next;
	});
}
