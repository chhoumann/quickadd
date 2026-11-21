import type ICaptureChoice from "./ICaptureChoice";
import type IMacroChoice from "./IMacroChoice";
import type IMultiChoice from "./IMultiChoice";
import type ITemplateChoice from "./ITemplateChoice";
import type { ChoiceType } from "./choiceType";

// Choice lists come from untrusted data.json, so these accept anything: `null`, a
// stray primitive, or an array reads as "not this choice" instead of throwing.
// They check the shape and `type` only; a Multi's `choices` may still be missing
// or malformed (see childChoicesOf / hasChildChoices).
function hasChoiceType(value: unknown, type: ChoiceType): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		(value as { type?: unknown }).type === type
	);
}

export function isTemplateChoice(choice: unknown): choice is ITemplateChoice {
	return hasChoiceType(choice, "Template");
}

export function isCaptureChoice(choice: unknown): choice is ICaptureChoice {
	return hasChoiceType(choice, "Capture");
}

export function isMacroChoice(choice: unknown): choice is IMacroChoice {
	return hasChoiceType(choice, "Macro");
}

export function isMultiChoice(choice: unknown): choice is IMultiChoice {
	return hasChoiceType(choice, "Multi");
}
