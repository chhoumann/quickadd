import type { CommandType } from "./CommandType";

export interface ICommand {
	name: string;
	type: CommandType;
	id: string;
}
