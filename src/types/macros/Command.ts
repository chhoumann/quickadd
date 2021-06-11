import type {CommandType} from "./CommandType";
import type {ICommand} from "./ICommand";

export abstract class Command implements ICommand {
    name: string;
    type: CommandType;

    protected constructor(name: string, type: CommandType) {
        this.name = name;
        this.type = type;
    }
}