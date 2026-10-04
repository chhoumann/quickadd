import type IChoice from "../types/choices/IChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { isChoiceLike } from "../utils/choiceUtils";
import { uuidv4 } from "../utils/uuid";
import { settingsValuesEqual, threeWayMergeSettings } from "../utils/settingsPersistMerge";
import { lowerNode } from "./lower";
import { migrateChoice, migrateSettingsV2 } from "./migrate";
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
	const { actions: stored, ...rest } = data;
	if (!Array.isArray(stored)) {
		// Kept as is, so a save writes it back instead of an empty list. Choices
		// a QuickAdd 2 device saved next to it stay the choices, and both are
		// written back (actionsFromChoices) until someone repairs the file.
		return Array.isArray(rest.choices) ? { ...rest, actions: stored, choices: rest.choices } : { ...rest, choices: stored };
	}
	// An entry this build cannot read is left out of the choices and kept in
	// `actions`, so one damaged action neither stops the plugin from loading
	// nor gets dropped by the next save. Repeated ids are healed here, as
	// dedupeChoicesById heals the choices, so the actions and the choices they
	// lower to keep agreeing and the next save still merges them by id.
	const actions = dedupeActionsById(stored);
	const readable = actions.filter(isReadableAction);
	const lowered = lowerActions(readable);
	// A QuickAdd 2 device on the same synced vault keeps `actions` and saves
	// the choices it adds next to them, at the root or inside a folder. Keep
	// those, so the next save moves them into `actions`.
	const ids = new Set<string>();
	const collect = (node: ActionNode) => {
		ids.add(node.id);
		if (node.kind === "folder") node.items.forEach(collect);
	};
	readable.forEach(collect);
	return { ...rest, actions, choices: withAddedChoices(lowered, rest.choices, ids) };
}

/** `lowered` with the choices in `saved` whose id no action has, folders included. */
function withAddedChoices(lowered: IChoice[], saved: unknown, ids: ReadonlySet<string>): IChoice[] {
	if (!Array.isArray(saved)) return lowered;
	const result = [...lowered];
	for (const choice of saved) {
		if (!isMigratableChoice(choice)) continue;
		if (!ids.has(choice.id)) {
			result.push(choice);
			continue;
		}
		const folder = result.find((entry) => entry.id === choice.id);
		if (folder?.type !== "Multi" || choice.type !== "Multi") continue;
		const items = (choice as IMultiChoice).choices;
		const children = (folder as IMultiChoice).choices;
		if (!Array.isArray(items) || !Array.isArray(children)) continue;
		const merged = withAddedChoices(children, items, ids);
		if (merged !== children) result[result.indexOf(folder)] = { ...folder, choices: merged } as IChoice;
	}
	return result.length === lowered.length && result.every((entry, index) => entry === lowered[index]) ? lowered : result;
}

/** Settings as data.json stores them once the choices were migrated to actions. */
export function actionsFromChoices<S extends { choices: unknown; actions?: ActionNode[]; migrations: { migrateToV3Actions?: boolean } }>(
	settings: S,
): object {
	if (!settings.migrations.migrateToV3Actions) return settings;
	const { choices, actions, ...rest } = settings;
	if (!Array.isArray(choices)) return { ...rest, actions: choices };
	// An unreadable action list is written back as found, the choices next to it.
	if (actions !== undefined && !Array.isArray(actions)) return { ...rest, actions, choices };
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
	const readable = actions.filter(isReadableAction);
	const lowered = lowerActions(readable);
	if (settingsValuesEqual(edited, lowered)) return actions;
	const roundTrip = migrateSettingsV2({ choices: lowered }).actions;
	const migrated = migrateSettingsV2({ choices: edited }).actions;
	const merged = threeWayMergeSettings(roundTrip, migrated, readable, ["actions"]);
	// Entries this build cannot read stay where they were.
	const result = [...merged];
	actions.forEach((node, index) => {
		if (!isReadableAction(node)) result.splice(Math.min(index, result.length), 0, node);
	});
	return result;
}

/**
 * Whether this build can lower `value` to a choice. The shape is checked
 * first; then lowering is tried, because a step this build does not know, or
 * a damaged one, shows only there. Anything else is kept verbatim and not shown.
 */
export function isReadableAction(value: unknown): value is ActionNode {
	if (!isActionNode(value)) return false;
	try {
		lowerNode(value);
		return true;
	} catch {
		return false;
	}
}

/**
 * A saved choice the migration can read, tried all the way down as
 * isReadableAction tries lowering; anything else would throw on the next save.
 */
function isMigratableChoice(value: unknown): value is IChoice {
	if (!isChoiceLike(value) || typeof value.id !== "string" || !CHOICE_TYPES.has(value.type)) return false;
	try {
		migrateChoice(value);
		return true;
	} catch {
		return false;
	}
}

const CHOICE_TYPES = new Set<unknown>(["Template", "Capture", "Macro", "Multi"]);

/**
 * The list with repeated ids healed the way dedupeChoicesById heals choices: a
 * repeat equal to the first occurrence is dropped, a differing one keeps its
 * data under a fresh id. Entries this build cannot read are kept verbatim.
 */
function dedupeActionsById(nodes: unknown[]): unknown[] {
	const firstById = new Map<string, unknown>();
	const walk = (list: unknown[]): unknown[] => {
		const out: unknown[] = [];
		for (const entry of list) {
			if (!isActionNode(entry)) {
				out.push(entry);
				continue;
			}
			let node: ActionNode = entry;
			const prior = firstById.get(node.id);
			if (prior) {
				if (JSON.stringify(node) === JSON.stringify(prior)) continue;
				node = { ...node, id: uuidv4() };
			}
			firstById.set(node.id, node);
			if (node.kind === "folder") node = { ...node, items: walk(node.items) as ActionNode[] };
			out.push(node);
		}
		return out;
	};
	return walk(nodes);
}

/** The shape of an action with its steps and `show`, or of a folder whose every item has it. */
export function isActionNode(value: unknown): value is ActionNode {
	if (!isRecord(value) || typeof value.id !== "string") return false;
	if (value.kind === "folder") return Array.isArray(value.items) && value.items.every(isActionNode);
	return value.kind === "action" && Array.isArray(value.steps) && isRecord(value.show);
}

function lowerActions(actions: ActionNode[]): IChoice[] {
	// JSON drops the keys lowering leaves undefined, so the loaded settings
	// compare equal to what the next load of the same file gives.
	return JSON.parse(JSON.stringify(actions.map(lowerNode))) as IChoice[];
}

/** The action with this id, in folders too. */
export function findAction(actions: readonly ActionNode[] | undefined, id: string): Action | undefined {
	for (const node of actions ?? []) {
		if (!isActionNode(node)) continue;
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
		if (!isActionNode(node)) return node;
		if (node.kind === "folder") return { ...node, items: updateAction(node.items, id, change) };
		return node.id === id ? change(node) : node;
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
