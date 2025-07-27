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
