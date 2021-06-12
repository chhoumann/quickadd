import {Formatter} from "./formatter";
import type {App, TFile} from "obsidian";
import {MACRO_REGEX, MARKDOWN_FILE_EXTENSION_REGEX} from "../constants";
import {getNaturalLanguageDates} from "../utility";
import GenericInputPrompt from "../gui/GenericInputPrompt/genericInputPrompt";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import {log} from "../logger/logManager";
import type QuickAdd from "../main";
import {SingleMacroEngine} from "../engine/SingleMacroEngine";

export class CompleteFormatter extends Formatter {
    private valueHeader: string;

    constructor(protected app: App, private plugin: QuickAdd) {
        super();
    }

    protected async format(input: string): Promise<string> {
        try {
            let output: string = input;

            output = this.replaceDateInString(output);
            output = await this.replaceValueInString(output);
            output = await this.replaceDateVariableInString(output);
            output = await this.replaceVariableInString(output);
            output = await this.replaceMacrosInString(output);

            return output;
        }
        catch (e) {
            log.logError(e);
        }
    }

    async formatFileName(input: string, valueHeader: string): Promise<string> {
        this.valueHeader = valueHeader;
        return await this.format(input);
    }

    async formatFileContent(input: string): Promise<string> {
        let output: string = input;

        output = await this.format(output);
        output = await this.replaceLinkToCurrentFileInString(output);

        return output;
    }

    protected getCurrentFilePath() {
        const currentFile: TFile = this.app.workspace.getActiveFile();
        if (!currentFile) return null;

        return currentFile.path.replace(MARKDOWN_FILE_EXTENSION_REGEX, '');
    }

    protected getNaturalLanguageDates() {
        return getNaturalLanguageDates(this.app);
    }

    protected getVariableValue(variableName: string): string {
        return this.variables.get(variableName);
    }

    protected async promptForValue(header?: string): Promise<string> {
        if (!this.value)
            this.value = await GenericInputPrompt.Prompt(this.app, this.valueHeader ?? `Enter value`);

        return this.value;
    }

    protected async promptForVariable(header?: string): Promise<string> {
        return await GenericInputPrompt.Prompt(this.app, header);
    }

    protected async suggestForValue(suggestedValues: string[]) {
        return await GenericSuggester.Suggest(this.app, suggestedValues, suggestedValues);
    }

    protected async getMacroValue(macroName: string): Promise<string> {
        const macroEngine: SingleMacroEngine = new SingleMacroEngine(this.app, this.plugin.settings.macros);
        return await macroEngine.runAndGetOutput(macroName);
    }
}