import type { ChoiceType } from "./choiceType";

export default interface IChoice {
	name: string;
	id: string;
	type: ChoiceType;
	command: boolean;
	/** Per-choice override for one-page flow. undefined = follow global setting */
	onePageInput?: "always" | "never" | undefined;
}
