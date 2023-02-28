import { CaptureChoice } from "src/types/choices/CaptureChoice";
import { ChoiceType } from "src/types/choices/choiceType";
import IChoice from "src/types/choices/IChoice";

export function isCaptureChoice(choice: IChoice): choice is CaptureChoice {
	return choice.type === ChoiceType.Capture;
}
