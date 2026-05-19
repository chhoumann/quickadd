import type { App } from "obsidian";
import type QuickAdd from "../main";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { MacroChoiceEngine } from "./MacroChoiceEngine";

type AsyncFunctionConstructor = new (code: string) => () => Promise<unknown>;

export class SingleInlineScriptEngine extends MacroChoiceEngine {
	constructor(
		app: App,
		plugin: QuickAdd,
		choiceExecutor: IChoiceExecutor,
		variables: Map<string, string>
	) {
		//@ts-ignore
		super(app, plugin, null, choiceExecutor, variables);
	}

	 
	public async runAndGetOutput(code: string): Promise<unknown> {
		const AsyncFunction = Object.getPrototypeOf(
			async function () {}
		).constructor as AsyncFunctionConstructor;

		const userCode = new AsyncFunction("quickAddApi", "app", "variables", "params", code);

		return await userCode.call(this, this.quickAddApi, this.app, this.variables, this.params);
	}
}
