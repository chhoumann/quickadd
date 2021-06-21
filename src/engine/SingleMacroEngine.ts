import type {App, TFile} from "obsidian";
import type {IMacro} from "../types/macros/IMacro";
import {MacroChoiceEngine} from "./MacroChoiceEngine";
import {log} from "../logger/logManager";
import {QuickAddApi} from "../quickAddApi";

export class SingleMacroEngine extends MacroChoiceEngine {
    public readonly params = {app: this.app, quickAddApi: QuickAddApi.GetApi(this.app), file: this.file, variables: {}};
    private memberAccess: string[];

    constructor(app: App, macros: IMacro[], private file?: TFile) {
        super(app, null, macros);
    }

    public async runAndGetOutput(macroName: string): Promise<string> {
        const splitName: string[] = macroName.split('::');
        const macro = this.macros.find(macro => macro.name === splitName[0]);
        if (!macro) return;

        if (splitName.length > 1) {
            this.memberAccess = splitName.slice(1);
        }

        await this.executeCommands(macro.commands)
        return this.output;
    }

    protected override async onExportIsObject(obj: any): Promise<void> {
        if (!this.memberAccess) return await this.userScriptDelegator(obj);
        let newObj = obj;
        this.memberAccess.forEach(key => {
           newObj = newObj[key];
        });

        await this.userScriptDelegator(newObj);
    }
}