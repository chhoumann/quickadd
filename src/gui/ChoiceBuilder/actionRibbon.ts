import { settingsStore } from "../../settingsStore";
import { flattenChoices } from "../../utils/choiceUtils";
import type { ActionNode } from "../../v3/model";
import { actionsFromChoices, findAction, updateAction } from "../../v3/storage";

export const RIBBON_SETTING_NAME = "Show in ribbon";

/**
 * Whether the action a choice stands for shows in the ribbon. Null when the
 * choice is not an action of its own: before the choices moved to actions,
 * and for a choice nested in a macro.
 */
export function actionInRibbon(choiceId: string): boolean | null {
	const settings = settingsStore.getState();
	if (!settings.migrations.migrateToV3Actions) return null;
	if (!flattenChoices(settings.choices).some((choice) => choice.id === choiceId)) return null;
	return findAction(settings.actions, choiceId)?.show.ribbon ?? false;
}

export function setActionInRibbon(choiceId: string, ribbon: boolean): void {
	// The actions as the next save writes them, so a choice added since the
	// last save has its action already.
	const { actions } = actionsFromChoices(settingsStore.getState()) as { actions: ActionNode[] };
	settingsStore.setState({
		actions: updateAction(actions, choiceId, (action) => {
			const show = { ...action.show };
			if (ribbon) show.ribbon = true;
			else delete show.ribbon;
			return { ...action, show };
		}),
	});
}
