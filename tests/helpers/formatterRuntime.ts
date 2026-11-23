import type { App } from "obsidian";
import type { FormatterExecutionRuntime } from "src/formatters/formatterRuntime";
import type { ChoiceRuntimePlugin } from "src/types/pluginContext";

/**
 * The engines' formatter runtime, loaded the first time a formatter runs code.
 * Loading it late keeps a test's `vi.mock` of an engine module in effect and
 * spares tests that never run code from loading the engines at all. Without
 * `app` and `plugin` it only runs code through mocked engines.
 */
export function testFormatterRuntime(app?: unknown, plugin?: unknown): FormatterExecutionRuntime {
	const load = async () =>
		(await import("src/engine/formatterRuntime")).createFormatterExecutionRuntime(
			app as App,
			plugin as ChoiceRuntimePlugin,
		);
	return {
		runMacro: async (request) => (await load()).runMacro(request),
		runTemplate: async (request) => (await load()).runTemplate(request),
		runInlineScript: async (request) => (await load()).runInlineScript(request),
	};
}
