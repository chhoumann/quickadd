import GenericWideInputPrompt from "./GenericWideInputPrompt/GenericWideInputPrompt";
import GenericInputPrompt from "./GenericInputPrompt/GenericInputPrompt";
import NumberInputPrompt from "./NumberInputPrompt/NumberInputPrompt";
import { getQuickAddInstance } from "../quickAddInstance";
import type { ValueInputType } from "../utils/valueSyntax";

export default class InputPrompt {
	public factory(inputTypeOverride?: ValueInputType) {
		if (inputTypeOverride === "multiline") {
			return GenericWideInputPrompt;
		}
		if (inputTypeOverride === "number") {
			return NumberInputPrompt;
		}
		// "checkbox" is resolved before the factory (a true/false suggester),
		// and "text" only affects YAML quoting at write time — both fall
		// through to the standard single-line prompt below.
		if (getQuickAddInstance().settings.inputPrompt === "multi-line") {
			return GenericWideInputPrompt;
		} else {
			return GenericInputPrompt;
		}
	}
}
