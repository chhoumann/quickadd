import { prepareFuzzySearch } from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type { CommandRegistry } from "../../services/choiceService";
import { childChoicesOf, hasChildChoices, isChoiceLike } from "../../utils/choiceUtils";
import { log } from "../../logger/logManager";
import { hasSeeded, seedChoiceTree } from "./seedChoiceTree";

export function seedChoices(raw: IChoice[], commandRegistry: CommandRegistry): IChoice[] {
	// An unreadable root must survive unchanged; rendering it as empty would allow data loss.
	if (!Array.isArray(raw)) return raw;
	const alreadySeeded = hasSeeded(raw);
	const { choices: seeded, repaired } = seedChoiceTree(raw);
	if (alreadySeeded) return seeded;

	// Repair registrations once across remounts; one failure must not hide the list.
	for (const { choice } of repaired) {
		if (!choice.command) continue;
		try {
			commandRegistry.enableCommand(choice);
		} catch (err) {
			log.logError(
				`Could not register a command for the repaired choice "${choice.name}": ${
					err instanceof Error ? err.message : String(err)
				}`,
			);
		}
	}
	return seeded;
}

export function filterChoices(list: IChoice[], query: string): IChoice[] {
	const q = query.trim();
	if (!q) return list;
	const match = prepareFuzzySearch(q);
	const plainQuery = q.toLowerCase();

	// Choices match fuzzily. A folder matches on its own only when its name
	// contains the query as plain text: then it shows its matching choices, or,
	// with none, everything inside it (`all`) instead of looking empty. A folder
	// that would only match fuzzily shows up only for its matching choices.
	const walk = (c: IChoice, all = false): IChoice | null => {
		if (!isChoiceLike(c)) return null;
		const name = typeof c.name === "string" ? c.name : "";
		if (c.type !== "Multi") {
			return all || match(name) ? c : null;
		}

		const selfMatches = all || name.toLowerCase().includes(plainQuery);
		const walkChildren = (keepAll: boolean) => childChoicesOf(c)
			.map((child) => walk(child, keepAll))
			.filter((choice): choice is IChoice => choice !== null);
		let filteredChildren = walkChildren(all);
		if (selfMatches && filteredChildren.length === 0) filteredChildren = walkChildren(true);

		if (selfMatches || filteredChildren.length > 0) {
			// Clone the folder, expanded, with the children kept above, to avoid mutating the original
			const expanded: IMultiChoice = {
				...c,
				collapsed: false,
				choices: filteredChildren,
			};
			return expanded;
		}

		return null;
	};

	return list.map((c) => walk(c)).filter((choice): choice is IChoice => choice !== null);
}

export function subtreeHasCommand(choice: IChoice): boolean {
	if (!isChoiceLike(choice)) return false;
	if (choice.command) return true;
	return childChoicesOf(choice).some(subtreeHasCommand);
}

export function updateChoiceHelper(oldChoice: IChoice, newChoice: IChoice): IChoice {
	if (!isChoiceLike(oldChoice)) return oldChoice;
	if (oldChoice.id === newChoice.id) {
		return { ...oldChoice, ...newChoice };
	}

	// Only rebuild a folder whose children we could actually read. This runs
	// over the WHOLE tree on every rename/configure/toggle and is followed by
	// save(), so spreading a folder with an unreadable `choices` value would
	// persist [] over it the first time the user renamed anything (#1566).
	if (hasChildChoices(oldChoice)) {
		const updatedChoices = childChoicesOf(oldChoice).map((c) =>
			updateChoiceHelper(c, newChoice),
		);
		const updated: IMultiChoice = {
			...(oldChoice as IMultiChoice),
			choices: updatedChoices,
		};
		return updated;
	}

	return oldChoice;
}

/**
 * The tree with the choice of `replacement`'s id swapped for it whole, keys
 * the old one had and it lacks included: for a choice whose type changed,
 * which updateChoiceHelper's merge would leave the old type's settings on.
 */
export function replaceChoiceHelper(oldChoice: IChoice, replacement: IChoice): IChoice {
	if (!isChoiceLike(oldChoice)) return oldChoice;
	if (oldChoice.id === replacement.id) return replacement;
	if (!hasChildChoices(oldChoice)) return oldChoice;
	const updated: IMultiChoice = {
		...(oldChoice as IMultiChoice),
		choices: childChoicesOf(oldChoice).map((child) => replaceChoiceHelper(child, replacement)),
	};
	return updated;
}
