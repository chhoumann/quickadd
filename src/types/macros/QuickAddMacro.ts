import type {ICommand} from "./ICommand";
import type {IMacro} from "./IMacro";
import {v4 as uuidv4} from "uuid";

export class QuickAddMacro implements IMacro {
    id: string;
    name: string;
    commands: ICommand[];
    runOnStartup: boolean;

    constructor(name: string) {
        this.name = name;
        this.id = uuidv4();
        this.commands = [];
        this.runOnStartup = false;
    }
}