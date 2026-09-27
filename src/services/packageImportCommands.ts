import type IChoice from "../types/choices/IChoice";
import { flattenChoices, flattenChoicesWithPath } from "../utils/choiceUtils";
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
 *
 * The result lists a folder's inline children next to the folder itself (the
 * import summary counts them). Registering a folder already walks its
 * children, so a choice whose ancestor is in the result is skipped here.
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
	const updated = flattenChoicesWithPath(result.updatedChoices);
	const updatedById = new Map(updated.map((entry) => [entry.id, entry.choice]));
	const parentById = new Map(updated.map((entry) => [entry.id, entry.parentId]));
	const listed = new Set([...result.overwrittenChoiceIds, ...result.addedChoiceIds]);
	const coveredByAncestor = (id: string): boolean => {
		for (let parent = parentById.get(id); parent; parent = parentById.get(parent)) {
			if (listed.has(parent)) return true;
		}
		return false;
	};

	for (const id of result.overwrittenChoiceIds) {
		if (coveredByAncestor(id)) continue;
		const previous = previousById.get(id);
		if (previous) registrar.removeCommandForChoice(previous, { recursive: true });
		const replacement = updatedById.get(id);
		if (replacement) registrar.addCommandForChoice(replacement);
	}

	for (const id of result.addedChoiceIds) {
		if (coveredByAncestor(id)) continue;
		const added = updatedById.get(id);
		if (added) registrar.addCommandForChoice(added);
	}
}
