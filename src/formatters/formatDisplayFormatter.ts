import {Formatter} from "./formatter";
import type {App} from "obsidian";
import {getNaturalLanguageDates} from "../utility";

export class FormatDisplayFormatter extends Formatter {
    constructor(private app: App) {
        super();
    }

    public async format(input: string): Promise<string> {
        let output: string = input;

        output = this.replaceDateInString(output);
        output = await this.replaceValueInString(output);
        output = await this.replaceDateVariableInString(output);
        output = await this.replaceVariableInString(output);
        output = await this.replaceLinkToCurrentFileInString(output);

        return output;
    }
    protected promptForValue(header?: string): string {
        return "_value_";
    }

    protected getVariableValue(variableName: string): string {
        return variableName;
    }

    protected getCurrentFilePath() {
        return this.app.workspace.getActiveFile()?.path ?? "_noPageOpen_";
    }

    protected getNaturalLanguageDates() {
        return getNaturalLanguageDates(this.app);
    }

    protected suggestForValue(suggestedValues: string[]) {
        return "_suggest_";
    }
}
