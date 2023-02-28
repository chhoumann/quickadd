import { ChoiceType } from "src/types/choices/choiceType";
import { MultiChoice } from "src/types/choices/MultiChoice";

export function isMultiChoice(choice: unknown): choice is MultiChoice {
	if (
		choice === null ||
		typeof choice !== "object" ||
		!("type" in choice) ||
		!("choices" in choice)
	) {
		return false;
	}

	return choice.type === ChoiceType.Multi && choice.choices !== undefined;
}
