import type IChoice from "./types/choices/IChoice";

export interface IChoiceExecutor {
    execute(choice: IChoice): Promise<void>;
}