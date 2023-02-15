import type IChoice from "./IChoice";

export default interface IMultiChoice extends IChoice {
	choices: IChoice[];
	collapsed: boolean;
}
