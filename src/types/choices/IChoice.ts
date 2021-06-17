import type {ChoiceType} from "./choiceType";

export default interface IChoice {
    name: string;
    id: string;
    type: ChoiceType;
    command: boolean;
}

