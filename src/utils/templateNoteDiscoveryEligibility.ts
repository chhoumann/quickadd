import { NAME_SYNTAX, VALUE_SYNTAX } from "src/constants";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";

export function usesDefaultTemplateTitlePrompt(
	choice: ITemplateChoice,
	format: string,
): boolean {
	if (!choice.fileNameFormat?.enabled) return true;
	const normalized = format.trim().toLowerCase();
	return (
		normalized === VALUE_SYNTAX.toLowerCase() ||
		normalized === NAME_SYNTAX.toLowerCase()
	);
}

export function shouldLeaveTemplateTitleForDiscovery(
	choice: ITemplateChoice,
	format: string,
): boolean {
	return (
		choice.discoverExistingNotesBeforeCreate === true &&
		usesDefaultTemplateTitlePrompt(choice, format)
	);
}

export function shouldRunTemplateNoteDiscovery(
	choice: ITemplateChoice,
	format: string,
	seededValue: unknown,
): boolean {
	if (!shouldLeaveTemplateTitleForDiscovery(choice, format)) return false;
	if (seededValue !== undefined && seededValue !== null) return false;
	return true;
}
