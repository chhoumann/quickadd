import type IChoice from "../types/choices/IChoice";
import { flattenChoices } from "../utils/choiceUtils";
import type { ApplyImportResult } from "./packageImportService";

/** The two plugin methods the command palette sync needs; QuickAdd (main.ts) satisfies it. */
export interface ChoiceCommandRegistrar {
	addCommandForChoice(choice: IChoice): void;
	removeCommandForChoice(
		choice: IChoice,
		options?: { recursive?: boolean },
	): void;
}

/**
 * Register palette commands for the choices a package import just added or
 * replaced. Commands are otherwise only registered at plugin load, so an
 * imported choice with the ⚡ toggle on would be invisible in the palette (and
 * to hotkeys) until the next reload — which is exactly when a fresh import is
 * most likely to be tried out.
 *
 * Overwritten choices drop their previous subtree's commands first, so a
 * renamed choice or a folder that lost children leaves no stale entries.
 */
export function syncImportedChoiceCommands(
	registrar: ChoiceCommandRegistrar,
	previousChoices: IChoice[],
	result: Pick<
		ApplyImportResult,
		"updatedChoices" | "addedChoiceIds" | "overwrittenChoiceIds"
	>,
): void {
	const previousById = new Map(
		flattenChoices(previousChoices).map((choice) => [choice.id, choice]),
	);
	const updatedById = new Map(
		flattenChoices(result.updatedChoices).map((choice) => [choice.id, choice]),
	);

	for (const id of result.overwrittenChoiceIds) {
		const previous = previousById.get(id);
		if (previous) registrar.removeCommandForChoice(previous, { recursive: true });
		const replacement = updatedById.get(id);
		if (replacement) registrar.addCommandForChoice(replacement);
	}

	for (const id of result.addedChoiceIds) {
		const added = updatedById.get(id);
		if (added) registrar.addCommandForChoice(added);
	}
}
