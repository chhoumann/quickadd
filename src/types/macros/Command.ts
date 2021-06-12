import type {CommandType} from "./CommandType";
import type {ICommand} from "./ICommand";
import {v4 as uuidv4} from "uuid";

export abstract class Command implements ICommand {
    name: string;
    type: CommandType;
    id: string;

    protected constructor(name: string, type: CommandType) {
        this.name = name;
        this.type = type;
        this.id = uuidv4();
    }
}