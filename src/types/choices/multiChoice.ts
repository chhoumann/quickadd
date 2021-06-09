import type {Choice} from "./choice";

export interface MultiChoice extends Choice {
    choices: Choice[];
}