import type Choice from "./choice";
import type {Macro} from "../macros/macro";

export default interface MacroChoice extends Choice {
    macro: Macro;
}