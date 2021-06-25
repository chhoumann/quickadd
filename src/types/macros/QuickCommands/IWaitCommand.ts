import type {ICommand} from "../ICommand";

export interface IWaitCommand extends ICommand {
    time: number;
}

