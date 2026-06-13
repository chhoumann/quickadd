import type { ChoiceType } from "./choiceType";

export default interface IChoice {
	name: string;
	id: string;
	type: ChoiceType;
	command: boolean;
	/** Per-choice override for one-page flow. undefined = follow global setting */
	onePageInput?: "always" | "never" | undefined;
	/**
	 * Optional per-choice icon id (lucide/Obsidian) for the registered command,
	 * shown on the mobile toolbar and in the command palette. undefined = use the
	 * per-type default (see resolveChoiceIcon). Never persisted as a default.
	 */
	icon?: string;
}
