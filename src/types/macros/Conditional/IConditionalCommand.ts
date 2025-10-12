import type { ICommand } from "../ICommand";
import type { ConditionalCondition } from "./types";

export interface IConditionalCommand extends ICommand {
	condition: ConditionalCondition;
	thenCommands: ICommand[];
	elseCommands: ICommand[];
}
