import type { ChoiceType } from "../../types/choices/choiceType";

export interface ChoiceTypeMeta {
	type: ChoiceType;
	/** Short, sentence-case label. */
	label: string;
	/** One-line explanation shown next to the label in the "New choice" menu. */
	description: string;
	/** Obsidian/lucide icon id. */
	iconId: string;
}

/**
 * The three "doer" choice types offered by the "New choice" menu. The fourth
 * type, `Multi`, is a folder/container and is offered as its own "New folder"
 * action rather than as a peer in this list — that separation is the whole point
 * of the redesign, so keep Multi OUT of here.
 */
export const DOER_CHOICE_TYPES: ChoiceTypeMeta[] = [
	{
		type: "Template",
		label: "Template",
		description: "Create a note from a template file.",
		iconId: "file-text",
	},
	{
		type: "Capture",
		label: "Capture",
		description: "Add text to a note — append, prepend, or insert.",
		iconId: "pencil",
	},
	{
		type: "Macro",
		label: "Macro",
		description: "Run a sequence of commands and scripts.",
		iconId: "terminal",
	},
];

/**
 * Auto-generated default name for a freshly added choice. The add flow never
 * gates on the user typing a name first (and never persists a nameless choice);
 * the name is editable immediately afterward in the builder / via rename.
 */
export function defaultChoiceName(type: ChoiceType): string {
	switch (type) {
		case "Template":
			return "New template";
		case "Capture":
			return "New capture";
		case "Macro":
			return "New macro";
		case "Multi":
			return "New folder";
	}
}
