import { Command } from "./Command";
import { CommandType } from "./CommandType";
import type { IChoiceCommand } from "./IChoiceCommand";

export class ChoiceCommand extends Command implements IChoiceCommand {
	choiceId: string;

	constructor(name: string, choiceId: string) {
		super(name, CommandType.Choice);

		this.choiceId = choiceId;
	}
}
