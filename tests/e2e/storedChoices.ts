import type { ObsidianClient } from "obsidian-e2e";
import type IChoice from "src/types/choices/IChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import { lowerNode } from "src/v3/lower";
import { migrateSettingsV2 } from "src/v3/migrate";
import type { ActionNode } from "src/v3/model";

/** data.json as QuickAdd 3 stores it: the choices live in `actions`. */
type Stored = { actions?: ActionNode[]; choices?: IChoice[] };

/** The choices in data.json, as QuickAdd loads them. */
export function storedChoices(data: object): IChoice[] {
	const stored = data as Stored;
	return stored.actions ? stored.actions.map(lowerNode) : (stored.choices ?? []);
}

/**
 * A data.json patch that edits the stored choices as v2 `choices` and writes
 * them back as actions, the way QuickAdd saves them.
 */
export function withStoredChoices<T extends object>(edit: (data: T) => void): (data: T) => void {
	return (data) => {
		const stored = data as Stored;
		stored.choices = storedChoices(data);
		delete stored.actions;
		edit(data);
		stored.actions = migrateSettingsV2({ choices: stored.choices }).actions;
		delete stored.choices;
	};
}

/**
 * Gives a macro's steps the ids QuickAdd loaded for them. A nested Template or
 * Capture is stored as steps of the action and loads under an id of its own,
 * and the one-page form names its fields after those ids.
 */
export async function useLoadedStepIds(obsidian: ObsidianClient, macro: IMacroChoice): Promise<void> {
	const ids = await obsidian.dev.evalJson<string[]>(`app.plugins.plugins.quickadd.settings.choices
		.find((choice) => choice.id === ${JSON.stringify(macro.id)}).macro.commands.map((command) => command.id)`);
	macro.macro.commands.forEach((command, index) => {
		command.id = ids[index];
	});
}
