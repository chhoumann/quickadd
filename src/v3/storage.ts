import type IChoice from "../types/choices/IChoice";
import { isChoiceLike } from "../utils/choiceUtils";
import { lowerNode } from "./lower";
import { migrateSettingsV2 } from "./migrate";
import type { ActionNode } from "./model";

/*
 * QuickAdd 3 stores `actions` in data.json, while the rest of the plugin
 * (engines, builder, CLI, URI, commands, packages) still reads and edits v2
 * `choices`. These two functions are the only place the shapes meet: loading
 * lowers the actions to choices, saving migrates the choices back to actions.
 * Migration is deterministic and lowering it again gives the same choices
 * (tests/v3), so saving unchanged choices writes unchanged actions.
 */

/** Raw data.json as the plugin holds it in memory: `actions` become `choices`. */
export function choicesFromActions(data: unknown): unknown {
	if (!isRecord(data) || !("actions" in data)) return data;
	const { actions, ...rest } = data;
	if (!Array.isArray(actions)) {
		// Kept as is, so a save writes it back instead of an empty list.
		return { ...rest, choices: actions };
	}
	// JSON drops the keys lowering leaves undefined, so the loaded settings
	// compare equal to what the next load of the same file gives.
	const lowered = JSON.parse(JSON.stringify((actions as ActionNode[]).map(lowerNode))) as IChoice[];
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
	return { ...rest, choices: [...lowered, ...added] };
}

/** Settings as data.json stores them once the choices were migrated to actions. */
export function actionsFromChoices<S extends { choices: unknown; migrations: { migrateToV3Actions?: boolean } }>(
	settings: S,
): object {
	if (!settings.migrations.migrateToV3Actions) return settings;
	if (!Array.isArray(settings.choices)) {
		const { choices, ...rest } = settings;
		return { ...rest, actions: choices };
	}
	return migrateSettingsV2(settings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
