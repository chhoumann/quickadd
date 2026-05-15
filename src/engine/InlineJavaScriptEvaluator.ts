import type { App } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import { MacroExecutionContext } from "./MacroExecutionContext";

type AsyncFunctionConstructor = new (code: string) => () => Promise<unknown>;

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

		return await userCode.bind(context.params, context.params).call();
	}
}
