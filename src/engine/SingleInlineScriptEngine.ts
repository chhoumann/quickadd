import type { App } from "obsidian";
import type { ChoiceRuntimePlugin } from "../types/pluginContext";
import type { FormatterExecutionRuntime } from "../formatters/formatterRuntime";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { ChoiceChain } from "./choiceChain";
import { createScriptParameters } from "./scriptParameters";
import type { ScriptParameters } from "./userScriptExecution";

type AsyncFunctionConstructor = new (code: string) => () => Promise<unknown>;

/** Runs a `js quickadd` block with the same `this` a user script gets as `params`. */
export class SingleInlineScriptEngine {
	public readonly params: ScriptParameters;

	constructor(
		app: App,
		plugin: ChoiceRuntimePlugin,
		runtime: FormatterExecutionRuntime,
		choiceExecutor: IChoiceExecutor,
		variables: Map<string, unknown>,
		chain: ChoiceChain,
	) {
		this.params = createScriptParameters({ app, plugin, runtime, choiceExecutor, variables, chain });
	}

	public async runAndGetOutput(code: string): Promise<unknown> {
		const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as AsyncFunctionConstructor;
		return await new AsyncFunction(code).call(this.params);
	}
}
