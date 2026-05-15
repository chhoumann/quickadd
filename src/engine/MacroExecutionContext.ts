import type { App } from "obsidian";
import * as obsidian from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { MacroAbortError } from "../errors/MacroAbortError";
import type QuickAdd from "../main";
import { QuickAddApi } from "../quickAddApi";
import { createVariablesProxy } from "../utils/variablesProxy";

export type MacroExecutionParams = {
	app: App;
	quickAddApi: QuickAddApi;
	variables: Record<string, unknown>;
	obsidian: typeof obsidian;
	abort: (message?: string) => never;
};

export class MacroExecutionContext {
	public readonly variables: Map<string, unknown>;
	public readonly params: MacroExecutionParams;

	constructor(
		app: App,
		plugin: QuickAdd,
		choiceExecutor: IChoiceExecutor,
		providedVariables?: Map<string, unknown>,
	) {
		this.variables = this.initSharedVariables(
			choiceExecutor,
			providedVariables,
		);
		choiceExecutor.variables = this.variables;
		this.params = this.buildParams(app, plugin, choiceExecutor);
	}

	private initSharedVariables(
		choiceExecutor: IChoiceExecutor,
		providedVariables?: Map<string, unknown>,
	): Map<string, unknown> {
		const existingVariables = choiceExecutor.variables;

		if (providedVariables) {
			if (existingVariables && providedVariables !== existingVariables) {
				existingVariables.forEach((value, key) => {
					if (!providedVariables.has(key)) {
						providedVariables.set(key, value);
					}
				});
			}
			return providedVariables;
		}

		return existingVariables ?? new Map<string, unknown>();
	}

	private buildParams(
		app: App,
		plugin: QuickAdd,
		choiceExecutor: IChoiceExecutor,
	): MacroExecutionParams {
		const variablesProxy = createVariablesProxy(this.variables);
		const params = {
			app,
			quickAddApi: QuickAddApi.GetApi(app, plugin, choiceExecutor),
			obsidian,
			abort: (message?: string) => {
				throw new MacroAbortError(message);
			},
		} as unknown as MacroExecutionParams;

		Object.defineProperty(params, "variables", {
			get: () => variablesProxy,
			set: (next: unknown) => {
				if (next === this.variables || next === variablesProxy) return;

				const entries =
					next instanceof Map
						? Array.from(next.entries()).filter(([key]) => typeof key === "string")
						: next && typeof next === "object"
							? Object.entries(next as Record<string, unknown>)
							: null;

				if (!entries) return;

				this.variables.clear();
				entries.forEach(([key, value]) => this.variables.set(key, value));
			},
			enumerable: true,
			configurable: false,
		});

		return params;
	}
}
