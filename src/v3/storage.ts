import type IChoice from "../types/choices/IChoice";
import { isChoiceLike } from "../utils/choiceUtils";
import { settingsValuesEqual, threeWayMergeSettings } from "../utils/settingsPersistMerge";
import { lowerNode } from "./lower";
import { migrateSettingsV2 } from "./migrate";
import type { Action, ActionNode } from "./model";

/*
 * QuickAdd 3 stores `actions` in data.json. In memory the plugin holds those
 * actions and, next to them, the v2 `choices` they lower to, because the rest
 * of the plugin (engines, builder, CLI, URI, commands, packages) still reads
 * and edits choices. The actions own their data: saving folds the edits made
 * to the choices into them (`actionsFromChoices`), and everything a choice
 * cannot hold stays as the actions have it.
 */

/** Settings in the shape data.json stores them: `actions` and no `choices`, once migrated. */
export type StoredSettings = Record<string, unknown>;

/** Raw data.json as the plugin holds it in memory: the actions, and the choices they lower to. */
export function choicesFromActions(data: unknown): unknown {
	if (!isRecord(data) || !("actions" in data)) return data;
	const { actions, ...rest } = data;
	if (!Array.isArray(actions)) {
		// Kept as is, so a save writes it back instead of an empty list.
		return { ...rest, choices: actions };
	}
	const lowered = lowerActions(actions as ActionNode[]);
	// A QuickAdd 2 device on the same synced vault keeps `actions` and saves
	// the choices it adds next to them. Keep those, so the next save moves
	// them into `actions`.
	const ids = new Set<string>();
	const collect = (node: ActionNode) => {
		ids.add(node.id);
		if (node.kind === "folder") node.items.forEach(collect);
	};
	(actions as ActionNode[]).forEach(collect);
	const added = Array.isArray(rest.choices)
		? (rest.choices as unknown[]).filter((choice) => isChoiceLike(choice) && !ids.has(choice.id))
		: [];
	return { ...rest, actions, choices: [...lowered, ...added] };
}

/** Settings as data.json stores them once the choices were migrated to actions. */
export function actionsFromChoices<S extends { choices: unknown; actions?: ActionNode[]; migrations: { migrateToV3Actions?: boolean } }>(
	settings: S,
): object {
	if (!settings.migrations.migrateToV3Actions) return settings;
	const { choices, actions, ...rest } = settings;
	if (!Array.isArray(choices)) return { ...rest, actions: choices };
	return { ...rest, actions: withChoiceEdits(actions ?? [], choices as IChoice[]) };
}

/**
 * The actions with the edits made to the choices they lowered to. Lowering
 * and migrating again (the round trip) gives each action as far as a choice
 * can express it; anything the round trip does not give back is the action's
 * own and kept. That is a three-way merge: the round trip is the base, the
 * migrated choices are the edit, and the actions are the other side. Lists
 * merge by id, so a step keeps what is its own when the steps around it
 * change, a removed choice removes its action and a new one adds one.
 */
function withChoiceEdits(actions: ActionNode[], choices: IChoice[]): ActionNode[] {
	// JSON: choices the builder made are class instances, some holding functions.
	const edited = JSON.parse(JSON.stringify(choices)) as IChoice[];
	const lowered = lowerActions(actions);
	if (settingsValuesEqual(edited, lowered)) return actions;
	const roundTrip = migrateSettingsV2({ choices: lowered }).actions;
	const migrated = migrateSettingsV2({ choices: edited }).actions;
	return threeWayMergeSettings(roundTrip, migrated, actions, ["actions"]);
}

function lowerActions(actions: ActionNode[]): IChoice[] {
	// JSON drops the keys lowering leaves undefined, so the loaded settings
	// compare equal to what the next load of the same file gives.
	return JSON.parse(JSON.stringify(actions.map(lowerNode))) as IChoice[];
}

/** The action with this id, in folders too. */
export function findAction(actions: readonly ActionNode[] | undefined, id: string): Action | undefined {
	for (const node of actions ?? []) {
		if (node.kind === "action" && node.id === id) return node;
		if (node.kind === "folder") {
			const found = findAction(node.items, id);
			if (found) return found;
		}
	}
	return undefined;
}

/** `actions` with the action of this id replaced by `change(action)`. */
export function updateAction(
	actions: readonly ActionNode[],
	id: string,
	change: (action: Action) => Action,
): ActionNode[] {
	return actions.map((node) => {
		if (node.kind === "folder") return { ...node, items: updateAction(node.items, id, change) };
		return node.id === id ? change(node) : node;
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
