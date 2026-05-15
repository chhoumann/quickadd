import type { App } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import { MacroExecutionContext } from "./MacroExecutionContext";

type AsyncFunctionConstructor = new (code: string) => () => Promise<unknown>;

type LegacyInlineScriptEngineShape = {
	params: MacroExecutionContext["params"];
	app: App;
	plugin: QuickAdd;
	choiceExecutor: IChoiceExecutor;
	variables: Map<string, unknown>;
};

export class InlineJavaScriptEvaluator {
	constructor(
		private readonly app: App,
		private readonly plugin: QuickAdd,
		private readonly choiceExecutor: IChoiceExecutor,
		private readonly variables: Map<string, unknown>,
	) {}

	public async runAndGetOutput(code: string): Promise<unknown> {
		const context = new MacroExecutionContext(
			this.app,
			this.plugin,
			this.choiceExecutor,
			this.variables,
		);
		const AsyncFunction = Object.getPrototypeOf(
			async function () {},
		).constructor as AsyncFunctionConstructor;
		const userCode = new AsyncFunction(code);
		const legacyEngine: LegacyInlineScriptEngineShape = {
			params: context.params,
			app: this.app,
			plugin: this.plugin,
			choiceExecutor: this.choiceExecutor,
			variables: context.variables,
		};

		return await userCode.bind(context.params, legacyEngine).call();
	}
}
