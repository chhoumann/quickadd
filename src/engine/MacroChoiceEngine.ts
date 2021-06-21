import type IMacroChoice from "../types/choices/IMacroChoice";
import type {App, TAbstractFile} from "obsidian";
import {TFile} from "obsidian";
import type {IUserScript} from "../types/macros/IUserScript";
import type {IObsidianCommand} from "../types/macros/IObsidianCommand";
import {log} from "../logger/logManager";
import {CommandType} from "../types/macros/CommandType";
import {QuickAddApi} from "../quickAddApi";
import type {ICommand} from "../types/macros/ICommand";
import {QuickAddChoiceEngine} from "./QuickAddChoiceEngine";
import type {IMacro} from "../types/macros/IMacro";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";

export class MacroChoiceEngine extends QuickAddChoiceEngine {
    public choice: IMacroChoice;
    protected output: string;
    protected readonly params = {app: this.app, quickAddApi: QuickAddApi.GetApi(this.app)};

    constructor(app: App, choice: IMacroChoice, protected macros: IMacro[]) {
        super(app);
        this.choice = choice;
    }

    async run(): Promise<void> {
        const macroId: string = this.choice.macroId ?? this.choice.macro.id;
        const macro: IMacro = this.macros.find(m => m.id === macroId);

        await this.executeCommands(macro.commands);
    }

    protected async executeCommands(commands: ICommand[]) {
        for (const command of commands) {
            if (command?.type === CommandType.Obsidian)
                await this.executeObsidianCommand(command as IObsidianCommand);
            if (command?.type === CommandType.UserScript)
                await this.executeUserScript(command as IUserScript);
        }
    }

    // Slightly modified from Templater's user script engine:
    // https://github.com/SilentVoid13/Templater/blob/master/src/UserTemplates/UserTemplateParser.ts
    protected async executeUserScript(command: IUserScript) {
        const userScript = await this.getUserScript(command);
        if (!userScript || !userScript.default) {
            log.logError(`failed to load user script ${command.path}.`);
            return;
        }

        await this.userScriptDelegator(userScript.default);
    }

    protected async userScriptDelegator(userScript: any) {
        switch (typeof userScript) {
            case "function":
                await this.onExportIsFunction(userScript);
                break;
            case "object":
                await this.onExportIsObject(userScript);
                break;
            case "bigint":
            case "boolean":
            case "number":
            case "string":
                this.output = userScript.toString();
                break;
            default:
                log.logError(`user script in macro for '${this.choice.name}' is invalid`);
        }
    }

    private async onExportIsFunction(userScript: any) {
        this.output = await userScript(this.params);
    }

    protected async onExportIsObject(obj: object) {
        const keys = Object.keys(obj);
        const selected: string = await GenericSuggester.Suggest(this.app, keys, keys);

        await this.userScriptDelegator(obj[selected]);
    }

    protected async getUserScript(command: IUserScript) {
        // @ts-ignore
        const vaultPath = this.app.vault.adapter.getBasePath();
        const file: TAbstractFile = this.app.vault.getAbstractFileByPath(command.path);
        if (!file) {
            log.logError(`failed to load file ${command.path}.`);
            return;
        }

        if (file instanceof TFile) {
            const filePath = `${vaultPath}/${file.path}`;

            if (window.require.cache[window.require.resolve(filePath)]) {
                delete window.require.cache[window.require.resolve(filePath)];
            }

            // @ts-ignore
            return await import(filePath);
        }
    }

    protected executeObsidianCommand(command: IObsidianCommand) {
        // @ts-ignore
        this.app.commands.executeCommandById(command.commandId);
    }
}

