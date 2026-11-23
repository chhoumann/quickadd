import type { ChoiceType } from "../types/choices/choiceType";

/**
 * What the UI calls a choice of this type: `Multi` is a folder on every
 * user-facing surface. The single source of that vocabulary, so a prompt never
 * asks for a "choice" name right after the user clicked New folder.
 */
export function choiceNoun(type?: ChoiceType): "folder" | "choice" {
	return type === "Multi" ? "folder" : "choice";
}

/** {@link choiceNoun}, capitalized for the start of a sentence or a heading. */
export function choiceNounCapitalized(type?: ChoiceType): "Folder" | "Choice" {
	return type === "Multi" ? "Folder" : "Choice";
}
