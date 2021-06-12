import {Command} from "./Command";
import {CommandType} from "./CommandType";
import type {IUserScript} from "./IUserScript";

export class UserScript extends Command implements IUserScript {
    name: string;
    path: string;
    type: CommandType;

    constructor(name: string, path: string) {
        super(name, CommandType.UserScript);
        this.path = path;
    }
}