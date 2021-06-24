import {Formatter} from "./formatter";
import type {App, TFile} from "obsidian";
import {getNaturalLanguageDates} from "../utility";
import GenericInputPrompt from "../gui/GenericInputPrompt/genericInputPrompt";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type QuickAdd from "../main";
import {SingleMacroEngine} from "../engine/SingleMacroEngine";
import {SingleTemplateEngine} from "../engine/SingleTemplateEngine";
import {MarkdownView} from "obsidian";
import type {IChoiceExecutor} from "../IChoiceExecutor";

export class CompleteFormatter extends Formatter {
    private valueHeader: string;

    constructor(protected app: App, private plugin: QuickAdd, protected choiceExecutor: IChoiceExecutor) {
        super();
    }

    protected async format(input: string): Promise<string> {
        let output: string = input;

        output = await this.replaceMacrosInString(output);
        output = await this.replaceTemplateInString(output);
        output = this.replaceDateInString(output);
        output = await this.replaceValueInString(output);
        output = await this.replaceDateVariableInString(output);
        output = await this.replaceVariableInString(output);

        return output;
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

    protected getCurrentFileLink() {
        const currentFile: TFile = this.app.workspace.getActiveFile();
        if (!currentFile) return null;

        return this.app.fileManager.generateMarkdownLink(currentFile, '');
    }

    protected getNaturalLanguageDates() {
        return getNaturalLanguageDates(this.app);
    }

    protected getVariableValue(variableName: string): string {
        return this.variables.get(variableName);
    }

    protected async promptForValue(header?: string): Promise<string> {
        if (!this.value) {
            const selectedText: string = await this.getSelectedText();
            this.value = selectedText ? selectedText :
                await GenericInputPrompt.Prompt(this.app, this.valueHeader ?? `Enter value`)
        }

        return this.value;
    }

    protected async promptForVariable(header?: string): Promise<string> {
        return await GenericInputPrompt.Prompt(this.app, header);
    }

    protected async suggestForValue(suggestedValues: string[]) {
        return await GenericSuggester.Suggest(this.app, suggestedValues, suggestedValues);
    }

    protected async getMacroValue(macroName: string): Promise<string> {
        const macroEngine: SingleMacroEngine = new SingleMacroEngine(this.app, this.plugin, this.plugin.settings.macros, this.choiceExecutor, this.variables);
        const macroOutput = await macroEngine.runAndGetOutput(macroName) ?? "";

        Object.keys(macroEngine.params.variables).forEach(key => {
            this.variables.set(key, macroEngine.params.variables[key]);
        })

        return macroOutput;
    }

    protected async getTemplateContent(templatePath: string): Promise<string> {
        return await new SingleTemplateEngine(this.app, this.plugin, templatePath, this.choiceExecutor).run();
    }

    protected async getSelectedText(): Promise<string> {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        return activeView.editor.getSelection();
    }
}