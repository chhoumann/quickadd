import type IChoice from "./IChoice";
import type {IMacro} from "../macros/IMacro";

export default interface IMacroChoice extends IChoice {
    macro: IMacro;
}

