import type { CaptureChoice } from "src/types/choices/CaptureChoice";
import { ChoiceType } from "src/types/choices/choiceType";
import type IChoice from "src/types/choices/IChoice";

export function isCaptureChoice(choice: IChoice): choice is CaptureChoice {
	return choice.type === ChoiceType.Capture;
}
