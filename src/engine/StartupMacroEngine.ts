import type {App} from "obsidian";
import type {IMacro} from "../types/macros/IMacro";
import {MacroChoiceEngine} from "./MacroChoiceEngine";

export class StartupMacroEngine extends MacroChoiceEngine {
    constructor(app: App, private macros: IMacro[]) {
        super(app, null);
    }

    async run(): Promise<void> {
        this.macros.forEach(macro => {
            if (macro.runOnStartup) {
                this.executeCommands(macro.commands);
            }
        })
    }
}