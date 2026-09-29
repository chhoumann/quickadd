import type ICaptureChoice from "./ICaptureChoice";
import type IChoice from "./IChoice";
import type IMacroChoice from "./IMacroChoice";
import type IMultiChoice from "./IMultiChoice";
import type ITemplateChoice from "./ITemplateChoice";

export type ChoiceType = "Capture" | "Macro" | "Multi" | "Template";

// These guards only read `type`. Callers walking untrusted data.json lists must
// check `isChoiceLike` first; a Multi's `choices` may still be missing or
// malformed (see childChoicesOf / hasChildChoices).
export function isTemplateChoice(choice: IChoice): choice is ITemplateChoice {
	return choice.type === "Template";
}

export function isCaptureChoice(choice: IChoice): choice is ICaptureChoice {
	return choice.type === "Capture";
}

export function isMacroChoice(choice: IChoice): choice is IMacroChoice {
	return choice.type === "Macro";
}

export function isMultiChoice(choice: IChoice): choice is IMultiChoice {
	return choice.type === "Multi";
}
