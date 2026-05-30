import GenericWideInputPrompt from "./GenericWideInputPrompt/GenericWideInputPrompt";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import { getQuickAddInstance } from "../quickAddInstance";
import type { ValueInputType } from "../utils/valueSyntax";

export default class InputPrompt {
	public factory(inputTypeOverride?: ValueInputType) {
		if (inputTypeOverride === "multiline") {
			return GenericWideInputPrompt;
		}
		if (getQuickAddInstance().settings.inputPrompt === "multi-line") {
			return GenericWideInputPrompt;
		} else {
			return GenericInputPrompt;
		}
	}
}
