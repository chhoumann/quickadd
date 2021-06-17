import type {ChoiceType} from "./choiceType";
import {v4 as uuidv4} from "uuid";
import type IChoice from "./IChoice";

export abstract class Choice implements IChoice {
    id: string;
    name: string;
    type: ChoiceType;
    command: boolean;

    protected constructor(name: string, type: ChoiceType) {
        this.id = uuidv4();
        this.name = name;
        this.type = type;
        this.command = false;
    }
}