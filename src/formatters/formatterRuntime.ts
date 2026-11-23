import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { ChoiceChain } from "../engine/choiceChain";
import type { TemplateInclusionState } from "./formatter";
import type { PromptRunContext, PromptScopeKind } from "./promptScope";

/**
 * Runs the code a format string can start: `{{MACRO:}}`, `{{TEMPLATE:}}` and
 * inline scripts. The engines implement it (`src/engine/formatterRuntime.ts`)
 * and hand it to the formatter they build, because the engines build
 * formatters and a formatter that imported an engine would close that loop.
 * Macros and inline scripts write to the `variables` map they are given.
 */
export interface FormatterExecutionRuntime {
	runMacro(request: {
		macroName: string;
		label?: string;
		choiceExecutor: IChoiceExecutor;
		variables: Map<string, unknown>;
		choiceChain: ChoiceChain;
	}): Promise<string>;

	runTemplate(request: {
		templatePath: string;
		choiceExecutor?: IChoiceExecutor;
		inclusion: TemplateInclusionState;
		targetFolderPath: string | null;
		choiceChain: ChoiceChain;
		preserveCursorMarkers: boolean;
		/** Absent keeps the template engine's own scope, the note body. */
		promptScope?: PromptScopeKind;
		promptRunContext?: PromptRunContext;
	}): Promise<{ content: string; templatePropertyVars: Map<string, unknown> }>;

	runInlineScript(request: {
		code: string;
		choiceExecutor: IChoiceExecutor;
		variables: Map<string, unknown>;
		choiceChain: ChoiceChain;
	}): Promise<unknown>;
}
