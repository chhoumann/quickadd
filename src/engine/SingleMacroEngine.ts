import type {App} from "obsidian";
import type {IMacro} from "../types/macros/IMacro";
import {MacroChoiceEngine} from "./MacroChoiceEngine";

export class SingleMacroEngine extends MacroChoiceEngine {
    constructor(app: App, macros: IMacro[]) {
        super(app, null, macros);
    }

    public async runAndGetOutput(macroName: string): Promise<string> {
        const macro = this.macros.find(macro => macro.name === macroName);
        if (!macro) return;

        await this.executeCommands(macro.commands)
        return this.output;
    }
}