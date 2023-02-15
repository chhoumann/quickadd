import type { ICommand } from "./ICommand";

export interface IChoiceCommand extends ICommand {
	choiceId: string;
}
