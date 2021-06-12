import {Command} from "./Command";
import {CommandType} from "./CommandType";
import type {IObsidianCommand} from "./IObsidianCommand";

export class ObsidianCommand extends Command implements IObsidianCommand {
    name: string;
    id: string;
    commandId: string;
    type: CommandType;

    constructor(name: string, commandId: string) {
        super(name, CommandType.Obsidian);
        this.commandId = commandId;
    }
}