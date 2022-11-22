import { Choice } from "src/types/choices/Choice";
import { ChoiceType } from "src/types/choices/choiceType";
import IMultiChoice from "src/types/choices/IMultiChoice";

export function IsActionFolder(choice: Choice): choice is IMultiChoice {
	return choice.type === ChoiceType.Multi;
}
