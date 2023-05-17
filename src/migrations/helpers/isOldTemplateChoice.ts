import type { TemplateChoice } from "src/types/choices/TemplateChoice";

export type OldTemplateChoice = TemplateChoice & {
	incrementFileName?: boolean;
};

export function isOldTemplateChoice(
	choice: unknown
): choice is OldTemplateChoice {
	if (typeof choice !== "object" || choice === null) return false;

	return "incrementFileName" in choice;
}
