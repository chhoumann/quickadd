import type IChoice from "./IChoice";

export type MultiChoiceDisplayMode = "suggester" | "context-menu";

export default interface IMultiChoice extends IChoice {
	choices: IChoice[];
	collapsed: boolean;
	placeholder?: string;
	displayMode?: MultiChoiceDisplayMode;
}
