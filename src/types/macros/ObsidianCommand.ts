import {Command} from "./Command";
import {CommandType} from "./CommandType";
import type {IObsidianCommand} from "./IObsidianCommand";

export class ObsidianCommand extends Command implements IObsidianCommand {
    name: string;
    id: string;
    type: CommandType;

    constructor(name: string, id: string) {
        super(name, CommandType.Obsidian);
        this.id = id;
    }
}