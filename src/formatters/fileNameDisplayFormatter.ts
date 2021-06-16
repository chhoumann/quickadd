import {Formatter} from "./formatter";
import type {App} from "obsidian";
import {getNaturalLanguageDates} from "../utility";

export class FileNameDisplayFormatter extends Formatter {
    constructor(private app: App) {
        super();
    }

    public async format(input: string): Promise<string> {
        let output: string = input;

        output = this.replaceDateInString(output);
        output = await this.replaceValueInString(output);
        output = await this.replaceDateVariableInString(output);
        output = await this.replaceVariableInString(output);

        return `File Name: ${output}`;
    }
    protected promptForValue(header?: string): string {
        return `FileName`;
    }

    protected getVariableValue(variableName: string): string {
        return variableName;
    }

    protected getCurrentFilePath() {
        return this.app.workspace.getActiveFile().path ?? "";
    }

    protected getNaturalLanguageDates() {
        return getNaturalLanguageDates(this.app);
    }

    protected suggestForValue(suggestedValues: string[]) {
        return "_suggest_";
    }

    protected getMacroValue(macroName: string) {
        return `_macro: ${macroName}`;
    }

    protected async promptForVariable(variableName: string): Promise<string> {
        return `_${variableName}_`;
    }

    protected async getTemplateContent(templatePath: string): Promise<string> {
        return `/${templatePath}/`;
    }

    protected async getSelectedText(): Promise<string> {
        return "_selected_";
    }
}