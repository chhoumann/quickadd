import {Formatter} from "./formatter";
import type {App, TFile} from "obsidian";
import {MARKDOWN_FILE_EXTENSION_REGEX} from "../constants";
import {getNaturalLanguageDates} from "../utility";
import GenericInputPrompt from "../gui/GenericInputPrompt/genericInputPrompt";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type QuickAdd from "../main";
import {SingleMacroEngine} from "../engine/SingleMacroEngine";
import {SingleTemplateEngine} from "../engine/SingleTemplateEngine";
import {MarkdownView} from "obsidian";

export class CompleteFormatter extends Formatter {
    private valueHeader: string;

    constructor(protected app: App, private plugin: QuickAdd) {
        super();
    }

    protected async format(input: string): Promise<string> {
        let output: string = input;

        output = this.replaceDateInString(output);
        output = await this.replaceValueInString(output);
        output = await this.replaceDateVariableInString(output);
        output = await this.replaceVariableInString(output);
        output = await this.replaceMacrosInString(output);
        output = await this.replaceTemplateInString(output);

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
        const macroEngine: SingleMacroEngine = new SingleMacroEngine(this.app, this.plugin.settings.macros);
        return await macroEngine.runAndGetOutput(macroName);
    }

    protected async getTemplateContent(templatePath: string): Promise<string> {
        return await new SingleTemplateEngine(this.app, this.plugin, templatePath).run();
    }

    protected async getSelectedText(): Promise<string> {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        return activeView.editor.getSelection();
    }
}