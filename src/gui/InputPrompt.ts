import GenericWideInputPrompt from "./GenericWideInputPrompt/GenericWideInputPrompt";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import QuickAdd from "../main";
import type { ValueInputType } from "../utils/valueSyntax";

export default class InputPrompt {
	public factory(inputType?: ValueInputType) {
		if (inputType === "multiline") {
			return GenericWideInputPrompt;
		}
		if (QuickAdd.instance.settings.inputPrompt === "multi-line") {
			return GenericWideInputPrompt;
		} else {
			return GenericInputPrompt;
		}
	}
}
