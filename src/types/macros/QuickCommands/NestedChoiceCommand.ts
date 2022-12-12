import { CommandType } from "../CommandType";
import { Command } from "../Command";
import type IChoice from "../../choices/IChoice";
import type { INestedChoiceCommand } from "./INestedChoiceCommand";

export class NestedChoiceCommand
	extends Command
	implements INestedChoiceCommand
{
	choice: IChoice;

	constructor(choice: IChoice) {
		super(choice.name, CommandType.NestedChoice);

		this.choice = choice;
	}
}
