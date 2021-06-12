import type {ICommand} from "./ICommand";

export interface IMacro {
    name: string;
    id: string;
    commands: ICommand[];
    runOnStartup: boolean;
}

