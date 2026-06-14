import type IChoice from "../types/choices/IChoice";
import { flattenChoicesWithPath, resolveChoiceIcon } from "../utils/choiceUtils";

/** One entry to add to Obsidian's mobile "share to" in-app menu (#632). */
export interface ShareMenuItem {
	/** Live choice id — resolve the choice fresh at click time, never close over a copy. */
	id: string;
	/** Menu title — the choice's name path, so duplicate names in different folders stay distinct. */
	title: string;
	/** Lucide/Obsidian icon id (per-choice override or per-type default). */
	icon: string;
}

/**
 * Select the choices opted into the share menu and shape each into a menu item.
 * Pure (no Obsidian/App): flatten the tree (so nested choices are reachable),
 * keep only `showInShareMenu`, and title by the name path. This is the exact
 * selection QuickAdd.registerShareMenu renders, so testing it pins the contract.
 */
export function collectShareMenuItems(choices: IChoice[]): ShareMenuItem[] {
	return flattenChoicesWithPath(choices)
		.filter((entry) => entry.choice.showInShareMenu)
		.map((entry) => ({
			id: entry.choice.id,
			title: entry.path.join(" / "),
			icon: resolveChoiceIcon(entry.choice),
		}));
}

/** The slice of ChoiceExecutor the share path needs — kept structural so this stays testable. */
export interface SharedTextExecutor {
	variables: Map<string, unknown>;
	execute(choice: IChoice): Promise<void>;
}

/**
 * Bind the shared text to the reserved `value` variable, then run the choice.
 * Seeding `value` is what makes a bare `{{VALUE}}` resolve to the shared text
 * WITHOUT a prompt (formatter reads a concrete `value` first); Macro user scripts
 * read the same via `params.variables.value`. Extracted so the value-seed contract
 * is unit-tested rather than living only in the event-handler closure.
 */
export async function runChoiceWithSharedText(
	executor: SharedTextExecutor,
	choice: IChoice,
	sharedText: string,
): Promise<void> {
	executor.variables.set("value", sharedText);
	await executor.execute(choice);
}
