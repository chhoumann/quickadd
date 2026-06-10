import type IMultiChoice from "src/types/choices/IMultiChoice";
import type IChoice from "../types/choices/IChoice";

function isMultiChoice(choice: IChoice): choice is IMultiChoice {
	return choice.type === "Multi";
}

/**
 * Recursively flattens the choice hierarchy into a single array.
 */
export function flattenChoices(choices: IChoice[]): IChoice[] {
	const result: IChoice[] = [];

	const walk = (choice: IChoice) => {
		result.push(choice);
		if (isMultiChoice(choice) && choice.choices) {
			choice.choices.forEach(walk);
		}
	};

	choices.forEach(walk);
	return result;
}

export interface FlatChoicePathEntry {
	choice: IChoice;
	id: string;
	/** Name path from the root to this choice, including the choice's own name. */
	path: string[];
	depth: number;
	parentId: string | null;
}

/**
 * Recursively flattens the choice hierarchy in pre-order, tracking each
 * choice's name path through its ancestor Multi choices.
 */
export function flattenChoicesWithPath(
	choices: IChoice[],
	parentPath: string[] = [],
	depth = 0,
	parentId: string | null = null,
): FlatChoicePathEntry[] {
	const result: FlatChoicePathEntry[] = [];
	for (const choice of choices) {
		const path = [...parentPath, choice.name];
		result.push({ choice, id: choice.id, path, depth, parentId });
		if (isMultiChoice(choice)) {
			result.push(
				...flattenChoicesWithPath(
					choice.choices ?? [],
					path,
					depth + 1,
					choice.id,
				),
			);
		}
	}
	return result;
}
