import type {ICommand} from "./ICommand";

export interface IUserScript extends ICommand {
    path: string;
    settings: {[key: string]: any}
}

