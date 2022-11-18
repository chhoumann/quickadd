import type {App} from "obsidian";
import type QuickAdd from "../main";
import type {IChoiceExecutor} from "../IChoiceExecutor";
import {MacroChoiceEngine} from "./MacroChoiceEngine";

export class SingleInlineScriptEngine extends MacroChoiceEngine {
    constructor(app: App, plugin: QuickAdd, choiceExecutor: IChoiceExecutor, variables: Map<string, string>) {
        super(app, plugin, null!, null!, choiceExecutor, variables);
    }

    public async runAndGetOutput(code: string): Promise<any> {
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor
        const userCode = new AsyncFunction(code);

        return await userCode.bind(this.params, this).call();
    }
}