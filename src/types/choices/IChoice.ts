import type { DateOrigin } from "../dateOrigin";
import type { ChoiceType } from "./choiceType";

export default interface IChoice {
	name: string;
	id: string;
	type: ChoiceType;
	command: boolean;
	/**
	 * How this choice picks the run's calendar origin for `{{DATE}}`.
	 * Undefined means inherit the run (or today).
	 */
	dateOrigin?: DateOrigin;
	/** Per-choice override for one-page flow. undefined = follow global setting */
	onePageInput?: "always" | "never" | undefined;
	/**
	 * Optional per-choice icon id (lucide/Obsidian), shown in the choice picker
	 * and on registered commands. undefined = use the per-type default (see
	 * resolveChoiceIcon). Never persisted as a default.
	 */
	icon?: string;
}
