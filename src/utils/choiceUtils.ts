import type IMultiChoice from "src/types/choices/IMultiChoice";
import type IChoice from "../types/choices/IChoice";

function isMultiChoice(choice: IChoice): choice is IMultiChoice {
	return choice.type === "Multi";
}

export interface FlattenChoicePathEntry {
	choice: IChoice;
	pathSegments: string[];
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

/**
 * Recursively flattens the choice hierarchy with breadcrumb path segments.
 */
export function flattenChoicesWithPath(
	choices: IChoice[],
	segments: string[] = [],
): FlattenChoicePathEntry[] {
	const result: FlattenChoicePathEntry[] = [];

	const walk = (choice: IChoice, parentSegments: string[]) => {
		const pathSegments = [...parentSegments, choice.name];
		result.push({
			choice,
			pathSegments,
		});
		if (isMultiChoice(choice) && choice.choices) {
			choice.choices.forEach((child) => walk(child, pathSegments));
		}
	};

	choices.forEach((choice) => walk(choice, segments));
	return result;
}
