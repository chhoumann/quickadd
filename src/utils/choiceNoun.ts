import type { ChoiceType } from "../types/choices/choiceType";

/**
 * What the UI calls a choice of this type.
 *
 * `Multi` is the internal type id for what every user-facing surface calls a
 * **folder** — "New folder", "Add folder to {name}", "Edit folder", "Folder
 * name", "Move to: (no folders)". Prompts that reached for the internal word
 * instead were jarring precisely where the stakes are highest: the rename
 * prompt asked for a *choice* name right after the user clicked *New folder*
 * (#1539), and the delete confirmation asked them to confirm deleting a
 * *choice* that contains *choices* (#1552).
 *
 * Both were fixed with a local ternary one function apart, which is how the
 * same bug shipped twice. This is the single source of that vocabulary, so the
 * next prompt gets it right for free.
 */
export function choiceNoun(type?: ChoiceType): "folder" | "choice" {
	return type === "Multi" ? "folder" : "choice";
}

/** {@link choiceNoun}, capitalized for the start of a sentence or a heading. */
export function choiceNounCapitalized(type?: ChoiceType): "Folder" | "Choice" {
	return type === "Multi" ? "Folder" : "Choice";
}
