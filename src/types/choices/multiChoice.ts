import type Choice from "./choice";

export default interface MultiChoice extends Choice {
    choices: Choice[];
    collapsed: boolean;
}