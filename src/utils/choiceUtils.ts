import type IChoice from "../types/choices/IChoice";

/**
 * Recursively flattens the choice hierarchy into a single array.
 */
export function flattenChoices(choices: IChoice[]): IChoice[] {
	const result: IChoice[] = [];

	const walk = (choice: IChoice) => {
		result.push(choice);
		if (choice.type === "Multi" && (choice as any).choices) {
			(choice as any).choices.forEach(walk);
		}
	};

	choices.forEach(walk);
	return result;
}
