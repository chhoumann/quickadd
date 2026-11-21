import type { App } from "obsidian";
import type { ChoiceRuntimePlugin } from "../types/pluginContext";
import type { FormatterExecutionRuntime } from "../formatters/formatterRuntime";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { ChoiceChain } from "./choiceChain";
import type IMacroChoice from "../types/choices/IMacroChoice";
import { MacroChoiceEngine } from "./MacroChoiceEngine";

type AsyncFunctionConstructor = new (code: string) => () => Promise<unknown>;

export class SingleInlineScriptEngine extends MacroChoiceEngine {
	constructor(
		app: App,
		plugin: ChoiceRuntimePlugin,
		runtime: FormatterExecutionRuntime,
		choiceExecutor: IChoiceExecutor,
		variables: Map<string, unknown>,
		chain: ChoiceChain,
	) {
		// An inline script runs with no macro choice of its own.
		super(app, plugin, runtime, null as unknown as IMacroChoice, choiceExecutor, variables, undefined, undefined, null, chain);
	}

	 
	public async runAndGetOutput(code: string): Promise<unknown> {
		const AsyncFunction = Object.getPrototypeOf(
			async function () {}
		).constructor as AsyncFunctionConstructor;
		 
		const userCode = new AsyncFunction(code);

		 
		return await userCode.bind(this.params, this).call();
	}
}
