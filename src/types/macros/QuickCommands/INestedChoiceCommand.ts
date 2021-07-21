import type {ICommand} from "../ICommand";
import type IChoice from "../../choices/IChoice";

export interface INestedChoiceCommand extends ICommand {
    choice: IChoice;
}