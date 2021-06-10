import {Choice} from "./Choice";
import {ChoiceType} from "./choiceType";
import type IMacroChoice from "./IMacroChoice";
import type {Macro} from "../macros/macro";

export class MacroChoice extends Choice implements IMacroChoice {
    macro: Macro;

    constructor(name: string) {
        super(name, ChoiceType.Macro);
    }
}