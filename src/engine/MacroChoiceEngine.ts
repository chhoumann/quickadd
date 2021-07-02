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
import type {IChoiceCommand} from "../types/macros/IChoiceCommand";
import type IChoice from "../types/choices/IChoice";
import type QuickAdd from "../main";
import type {IChoiceExecutor} from "../IChoiceExecutor";
import {ChoiceType} from "../types/choices/choiceType";
import type IMultiChoice from "../types/choices/IMultiChoice";
import {getUserScriptMemberAccess, waitFor} from "../utility";
import type {IWaitCommand} from "../types/macros/QuickCommands/IWaitCommand";

export class MacroChoiceEngine extends QuickAddChoiceEngine {
    public choice: IMacroChoice;
    public params;
    protected output: string;
    protected macros: IMacro[];
    protected choiceExecutor: IChoiceExecutor;
    protected readonly plugin: QuickAdd;

    constructor(app: App, plugin: QuickAdd, choice: IMacroChoice, macros: IMacro[], choiceExecutor: IChoiceExecutor, variables: Map<string, string>) {
        super(app);
        this.choice = choice;
        this.plugin = plugin;
        this.macros = macros;
        this.choiceExecutor = choiceExecutor;
        this.params = {app: this.app, quickAddApi: QuickAddApi.GetApi(app, plugin, choiceExecutor), variables: {}};

        variables?.forEach(((value, key) => {
            this.params.variables[key] = value;
        }));
    }

    async run(): Promise<void> {
        const macroId: string = this.choice.macroId ?? this.choice?.macro?.id;
        const macro: IMacro = this.macros.find(m => m.id === macroId);

        if (!macro || !macro?.commands) {
            log.logError(`No commands in the selected macro. Did you select a macro for '${this.choice.name}'?`)
        }

        await this.executeCommands(macro.commands);
    }


    protected async executeCommands(commands: ICommand[]) {
        for (const command of commands) {
            if (command?.type === CommandType.Obsidian)
                await this.executeObsidianCommand(command as IObsidianCommand);
            if (command?.type === CommandType.UserScript)
                await this.executeUserScript(command as IUserScript);
            if (command?.type === CommandType.Choice)
                await this.executeChoice(command as IChoiceCommand);
            if (command?.type === CommandType.Wait) {
                const waitCommand: IWaitCommand = (command as IWaitCommand);
                await waitFor(waitCommand.time);
            }
        }
    }

    // Slightly modified from Templater's user script engine:
    // https://github.com/SilentVoid13/Templater/blob/master/src/UserTemplates/UserTemplateParser.ts
    protected async executeUserScript(command: IUserScript) {
        const userScript = await this.getUserScript(command);
        if (!userScript) {
            log.logError(`failed to load user script ${command.path}.`);
            return;
        }

        await this.userScriptDelegator(userScript);
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
        try {
            const keys = Object.keys(obj);
            const selected: string = await GenericSuggester.Suggest(this.app, keys, keys);

            await this.userScriptDelegator(obj[selected]);
        } catch (e) {
            log.logMessage(e);
        }
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
            const userScript = await import(filePath);
            if (!userScript || !userScript.default) return;

            let script = userScript.default;

            const {memberAccess} = getUserScriptMemberAccess(command.name);
            if (memberAccess && memberAccess.length > 0) {
                let member: string;
                while(member = memberAccess.shift()) {
                    script = script[member];
                }
            }

            return script;
        }
    }

    protected executeObsidianCommand(command: IObsidianCommand) {
        // @ts-ignore
        this.app.commands.executeCommandById(command.commandId);
    }

    protected async executeChoice(command: IChoiceCommand) {
        const choices: IChoice[] = this.plugin.settings.choices;

        const findChoice = (choiceArr: IChoice[]) => {
            let tempChoice: IChoice;
            for (const choice of choiceArr) {
                tempChoice = choice;

                if (choice.type === ChoiceType.Multi)
                    tempChoice = findChoice((<IMultiChoice> choice).choices);

                if (tempChoice.id === command.choiceId)
                    return tempChoice;
            }
        }

        const targetChoice = findChoice(choices);
        if (!targetChoice) {
            log.logError("choice could not be found.");
            return;
        }

        await this.choiceExecutor.execute(targetChoice);
    }
}