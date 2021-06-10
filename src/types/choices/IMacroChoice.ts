import type IChoice from "./IChoice";
import type {Macro} from "../macros/macro";

export default interface IMacroChoice extends IChoice {
    macro: Macro;
}

