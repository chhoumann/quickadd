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

	const walk = (c: IChoice): IChoice | null => {
		if (!isChoiceLike(c)) return null;
		const selfMatches = !!match(c.name ?? "");
		if (c.type !== "Multi") {
			return selfMatches ? c : null;
		}

		const filteredChildren = childChoicesOf(c)
			.map((child) => walk(child))
			.filter((choice): choice is IChoice => choice !== null);

		if (selfMatches || filteredChildren.length > 0) {
			// Clone Multi node expanded with only matching children to avoid mutating original
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
