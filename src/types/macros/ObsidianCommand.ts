import { Command } from "./Command";
import { CommandType } from "./CommandType";
import type { IObsidianCommand } from "./IObsidianCommand";
import { v4 as uuidv4 } from "uuid";

export class ObsidianCommand extends Command implements IObsidianCommand {
	declare name: string;
	declare id: string;
	commandId: string;
	declare type: CommandType;

	constructor(name: string, commandId: string) {
		super(name, CommandType.Obsidian);
		this.commandId = commandId;
	}

	generateId = () => (this.id = uuidv4());
}
