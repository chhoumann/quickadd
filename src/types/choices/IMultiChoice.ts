import type IChoice from "./IChoice";

export type MultiChoiceDisplayMode = "picker" | "menu";

export default interface IMultiChoice extends IChoice {
	choices: IChoice[];
	collapsed: boolean;
	placeholder?: string;
	displayMode?: MultiChoiceDisplayMode;
}
