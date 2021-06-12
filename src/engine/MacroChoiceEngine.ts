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

export class MacroChoiceEngine extends QuickAddChoiceEngine {
    choice: IMacroChoice;
    protected output: string;

    constructor(app: App, choice: IMacroChoice) {
        super(app);
        this.choice = choice;
    }

    async run(): Promise<void> {
        await this.executeCommands(this.choice.macro.commands);
    }

    protected async executeCommands(commands: ICommand[]) {
        for (const command of commands) {
            if (command.type === CommandType.Obsidian)
                await this.executeObsidianCommand(command as IObsidianCommand);
            if (command.type === CommandType.UserScript)
                await this.executeUserScript(command as IUserScript);
        }
    }

    // Slightly modified from Templater's user script engine:
    // https://github.com/SilentVoid13/Templater/blob/master/src/UserTemplates/UserTemplateParser.ts
    protected async executeUserScript(command: IUserScript) {
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
            const userScript = await import(filePath);
            if (!userScript.default || !(userScript.default instanceof Function)) {
                log.logError(`failed to load user script ${filePath}.`);
                return;
            }

            this.output = await userScript.default({app: this.app, quickAddApi: QuickAddApi.GetApi(this.app)});
        }
    }

    protected executeObsidianCommand(command: IObsidianCommand) {
        // @ts-ignore
        this.app.commands.executeCommandById(command.id);
    }
}

