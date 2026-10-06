import { settingsStore } from "../../settingsStore";
import { flattenChoices } from "../../utils/choiceUtils";
import type { Action, ActionNode } from "../../v3/model";
import { currentActions, findAction, updateAction } from "../../v3/storage";

export const RIBBON_SETTING_NAME = "Show in ribbon";

/**
 * Whether a choice is an action of its own. It is not before the choices
 * moved to actions, nor when nested in a macro.
 */
export function isOwnAction(choiceId: string): boolean {
	const settings = settingsStore.getState();
	return settings.migrations.migrateToV3Actions && flattenChoices(settings.choices).some((choice) => choice.id === choiceId);
}

/** Changes the action a choice stands for, in the settings the next save writes. */
export function changeAction(choiceId: string, change: (action: Action) => Action): void {
	// A choice added since the last save has its action already.
	const actions = currentActions(settingsStore.getState()) as ActionNode[];
	settingsStore.setState({ actions: updateAction(actions, choiceId, change) });
}

/** Whether the action a choice stands for shows in the ribbon. Null when the choice is not an action of its own. */
export function actionInRibbon(choiceId: string): boolean | null {
	if (!isOwnAction(choiceId)) return null;
	return findAction(settingsStore.getState().actions, choiceId)?.show.ribbon ?? false;
}

export function setActionInRibbon(choiceId: string, ribbon: boolean): void {
	changeAction(choiceId, (action) => {
		const show = { ...action.show };
		if (ribbon) show.ribbon = true;
		else delete show.ribbon;
		return { ...action, show };
	});
}
