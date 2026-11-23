import type { App } from "obsidian";
import type { FormatterExecutionRuntime } from "../formatters/formatterRuntime";
import type { ChoiceRuntimePlugin } from "../types/pluginContext";
import { SingleInlineScriptEngine } from "./SingleInlineScriptEngine";
import { SingleMacroEngine } from "./SingleMacroEngine";
import { SingleTemplateEngine } from "./SingleTemplateEngine";

/** Runs a formatter's `{{MACRO:}}`, `{{TEMPLATE:}}` and inline scripts with the engines. */
export function createFormatterExecutionRuntime(
	app: App,
	plugin: ChoiceRuntimePlugin,
): FormatterExecutionRuntime {
	const runtime: FormatterExecutionRuntime = {
		async runMacro({ macroName, label, choiceExecutor, variables, choiceChain }) {
			const engine = new SingleMacroEngine(
				app,
				plugin,
				runtime,
				plugin.settings.choices,
				choiceExecutor,
				variables,
			);
			return engine.runAndGetOutput(macroName, { label }, choiceChain);
		},

		async runTemplate(request) {
			const engine = new SingleTemplateEngine(
				app,
				plugin,
				runtime,
				request.templatePath,
				request.choiceExecutor,
				request.inclusion,
			);
			// {{FOLDER}} inside the included template resolves to the includer's folder.
			engine.setTargetFolderPath(request.targetFolderPath);
			engine.choiceChain = request.choiceChain;
			if (request.preserveCursorMarkers) engine.setPreserveCursorMarkers(true);
			if (request.promptScope) engine.setPromptScope(request.promptScope);
			if (request.promptRunContext) engine.setPromptRunContext(request.promptRunContext);
			const content = await engine.run();
			return {
				content,
				templatePropertyVars: engine.getAndClearTemplatePropertyVars(),
			};
		},

		async runInlineScript({ code, choiceExecutor, variables, choiceChain }) {
			const engine = new SingleInlineScriptEngine(
				app,
				plugin,
				runtime,
				choiceExecutor,
				variables,
				choiceChain,
			);
			return engine.runAndGetOutput(code);
		},
	};
	return runtime;
}
