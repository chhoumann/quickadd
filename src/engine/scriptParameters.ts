import type { App } from "obsidian";
import * as obsidian from "obsidian";
import { QuickAddApi } from "../quickAddApi";
import { restoreDateVariableFormats } from "../formatters/helpers/dateTokens";
import { MacroAbortError } from "../errors/MacroAbortError";
import { createVariablesProxy } from "../utils/variablesProxy";
import type { ChoiceRuntimePlugin } from "../types/pluginContext";
import type { FormatterExecutionRuntime } from "../formatters/formatterRuntime";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { ChoiceChain } from "./choiceChain";
import type { ScriptParameters } from "./userScriptExecution";

/**
 * The run's variable map a script works on. A caller's own map is used and
 * gains the executor's entries it lacks; either way the executor is pointed at
 * the result, so a script, the formatter and later steps all share one map.
 */
function sharedVariablesFor(
	choiceExecutor: IChoiceExecutor,
	providedVariables?: Map<string, unknown>,
): Map<string, unknown> {
	const existingVariables = choiceExecutor.variables;
	let shared = existingVariables ?? new Map<string, unknown>();

	if (providedVariables) {
		if (existingVariables && providedVariables !== existingVariables) {
			existingVariables.forEach((value, key) => {
				if (!providedVariables.has(key)) providedVariables.set(key, value);
			});
		}
		shared = providedVariables;
	}

	choiceExecutor.variables = shared;
	return shared;
}

/** The `params` a user script, conditional script, or inline script receives. */
export function createScriptParameters(context: {
	app: App;
	plugin: ChoiceRuntimePlugin;
	runtime: FormatterExecutionRuntime;
	choiceExecutor: IChoiceExecutor;
	variables?: Map<string, unknown>;
	chain?: ChoiceChain;
}): ScriptParameters {
	const { app, plugin, runtime, choiceExecutor, chain } = context;
	const sharedVariables = sharedVariablesFor(choiceExecutor, context.variables);
	const variablesProxy = createVariablesProxy(sharedVariables);

	const params = {
		app,
		quickAddApi: QuickAddApi.GetApi(app, plugin, choiceExecutor, runtime, chain),
		obsidian,
		abort: (message?: string) => {
			throw new MacroAbortError(message);
		},
	} as unknown as ScriptParameters;

	// Backward compatibility: some scripts assign `QuickAdd.variables = {...}`
	// or `params.variables = {...}`.
	// Treat that as replacing the backing Map so templates can consume them.
	Object.defineProperty(params, "variables", {
		get: () => variablesProxy,
		set: (next: unknown) => {
			if (next === sharedVariables || next === variablesProxy) return;

			const entries =
				next instanceof Map
					? Array.from(next.entries()).filter(([key]) => typeof key === "string")
					: next && typeof next === "object"
						? Object.entries(next as Record<string, unknown>)
						: null;

			// Invalid assignments are ignored to avoid wiping the backing store.
			if (!entries) return;

			sharedVariables.clear();
			restoreDateVariableFormats(sharedVariables, new Map());

			entries.forEach(([key, value]) => sharedVariables.set(key, value));
		},
		enumerable: true,
		configurable: false,
	});

	return params;
}
