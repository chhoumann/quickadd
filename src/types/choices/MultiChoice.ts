import {Choice} from "./Choice";
import type IChoice from "./IChoice";
import {ChoiceType} from "./choiceType";
import type IMultiChoice from "./IMultiChoice";

export class MultiChoice extends Choice implements IMultiChoice {
    choices: IChoice[];
    collapsed: boolean;

    constructor(name: string) {
        super(name, ChoiceType.Multi);
    }
}