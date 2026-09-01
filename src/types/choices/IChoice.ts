import type { DateOrigin } from "../dateOrigin";
import type { ChoiceType } from "./choiceType";

export default interface IChoice {
	name: string;
	id: string;
	type: ChoiceType;
	command: boolean;
	/**
	 * Which day `{{DATE}}` uses. Undefined means today (or a parent run).
	 */
	dateOrigin?: DateOrigin;
	/**
	 * When true and `command` is on, also register `Name (pick a day)`, which
	 * asks for the day before running. Undefined/false = off. Ask-each-time
	 * choices never get it (the main command already prompts).
	 */
	pickDayCommand?: boolean;
	/** Per-choice override for one-page flow. undefined = follow global setting */
	onePageInput?: "always" | "never" | undefined;
	/**
	 * Optional per-choice icon id (lucide/Obsidian), shown in the choice picker
	 * and on registered commands. undefined = use the per-type default (see
	 * resolveChoiceIcon). Never persisted as a default.
	 */
	icon?: string;
}
