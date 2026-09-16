import type { App } from "obsidian";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import type { InputPromptOptions } from "../../types/inputPrompt";
import type { PromptContext } from "../formatter";
import { buildPromptContextLine, scopeShowsDestination, type PromptScopeKind, type PromptRunContext } from "../promptScope";
import InputPrompt from "../../gui/InputPrompt";
import InputSuggester from "../../gui/InputSuggester/inputSuggester";
import GenericSuggester from "../../gui/GenericSuggester/genericSuggester";
import MultiSuggester from "../../gui/MultiSuggester/multiSuggester";
import VDateInputPrompt from "../../gui/VDateInputPrompt/VDateInputPrompt";
import { UserCancelError } from "../../errors/UserCancelError";
import { isCancellationError } from "../../utils/errorUtils";

export interface PromptRuntime {
	app: App;
	executor: IChoiceExecutor | undefined;
	scope: PromptScopeKind;
	runContext: PromptRunContext | undefined;
	assertInteractivePrompt: (what: string) => void;
	buildInputPromptOptions: (context?: PromptContext, line?: string, full?: string) => InputPromptOptions;
}

export async function promptForVariable(runtime: PromptRuntime, header?: string,
	context?: PromptContext): Promise<string> {
	// Route to a remote interactive session (Raycast) when one is driving.
	const provider = runtime.executor?.promptProvider;
	if (provider) {
		if (context?.type === "VDATE") {
			return await provider.datePrompt(
				header ?? context.label ?? "Enter date",
				{
					defaultValue: context.defaultValue,
					dateFormat: context.dateFormat ?? "YYYY-MM-DD",
					// Carry |time/|datetime so the remote client renders a time
					// picker; otherwise the picked time is silently dropped.
					withTime: context.withTime,
				},
			);
		}
		if (context?.inputTypeOverride === "checkbox") {
			return String(
				await provider.suggester(
					["true", "false"],
					["true", "false"],
					context.description ?? header ?? context.label ?? "Choose value",
					false,
				),
			);
		}
		return await provider.inputPrompt(
			header ?? context?.label ?? "Enter value",
			context?.placeholder,
			context?.defaultValue,
		);
	}
	runtime.assertInteractivePrompt(
		header ? `{{VALUE:${header}}}` : "a template variable",
	);
	try {
		// Named prompts already title themselves with the variable name, so they
		// only gain the run context: which choice is asking, and where the
		// answer lands (issue #1546).
		const variableTitle = header ?? context?.label ?? "Enter value";
		const showDestination = scopeShowsDestination(runtime.scope);
		const namedContextLine = buildPromptContextLine(
			runtime.runContext,
			variableTitle,
			{ showDestination },
		);
		const namedContextLineFull = buildPromptContextLine(
			runtime.runContext,
			variableTitle,
			{ elide: false, showDestination },
		);

		// Use VDateInputPrompt for VDATE variables
		if (context?.type === "VDATE") {
			return await VDateInputPrompt.Prompt(
				runtime.app,
				(header as string) ?? context.label ?? "Enter date",
				context.withTime
					? "Enter a date & time (e.g., 'tomorrow at 3pm', '2025-12-25 14:30')"
					: "Enter a date (e.g., 'tomorrow', 'next friday', '2025-12-25')",
				context.defaultValue,
				context.dateFormat ?? "YYYY-MM-DD",
				{
					optional: context.optional,
					contextLine: namedContextLine,
					contextLineFull: namedContextLineFull,
					draftScopeId: runtime.runContext?.draftScopeId,
				},
				context.withTime,
			);
		}

		// {{VALUE:x|type:checkbox}} renders a forced true/false picker (no
		// free text) so the written `x: true` round-trips as a Checkbox. The
		// |label (carried as description for single-value tokens) becomes the
		// modal title so the user knows which property they are setting (#202).
		if (context?.inputTypeOverride === "checkbox") {
			return await GenericSuggester.Suggest(
				runtime.app,
				["true", "false"],
				["true", "false"],
				context.description ?? header ?? context.label ?? "Choose value",
				undefined,
				context.optional ? { skippable: true } : undefined,
			);
		}

		// Use default prompt for other variables
		return await new InputPrompt().factory(context?.inputTypeOverride).Prompt(
			runtime.app,
			variableTitle,
			context?.placeholder ??
				(context?.defaultValue ? context.defaultValue : undefined),
			context?.defaultValue,
			context?.description,
			runtime.buildInputPromptOptions(
				context,
				namedContextLine,
				namedContextLineFull,
			),
		);
	} catch (error) {
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}

export async function suggestForValue(runtime: PromptRuntime, suggestedValues: string[],
	allowCustomInput = false,
	context?: {
		placeholder?: string;
		variableKey?: string;
		displayValues?: string[];
		optional?: boolean;
	}): Promise<string> {
	// Route to a remote interactive session (Raycast) when one is driving this
	// run - covers `{{VALUE:a,b,c}}` option lists in a template/capture format
	// (e.g. a rating field) that the requirement collector didn't pre-satisfy.
	const provider = runtime.executor?.promptProvider;
	if (provider) {
		// Formatter tokens resolve to strings; the provider hands back the
		// selected actualItems entry (here always a string) or a custom value.
		return String(
			await provider.suggester(
				context?.displayValues ?? suggestedValues,
				suggestedValues,
				context?.placeholder,
				allowCustomInput,
			),
		);
	}
	runtime.assertInteractivePrompt(
		context?.variableKey ? `{{VALUE:${context.variableKey}}}` : "a value choice",
	);
	try {
		const displayValues = context?.displayValues ?? suggestedValues;
		if (allowCustomInput) {
			return await InputSuggester.Suggest(
				runtime.app,
				displayValues,
				suggestedValues,
				{
					...(context?.placeholder
						? { placeholder: context.placeholder }
						: {}),
					...(context?.optional ? { skippable: true } : {}),
				},
			);
		}
		return await GenericSuggester.Suggest(
			runtime.app,
			displayValues,
			suggestedValues,
			context?.placeholder,
			undefined,
			context?.optional ? { skippable: true } : undefined,
		);
	} catch (error) {
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}

export async function suggestForValueMulti(runtime: PromptRuntime, suggestedValues: string[],
	allowCustomInput = false,
	context?: {
		placeholder?: string;
		variableKey?: string;
		displayValues?: string[];
		optional?: boolean;
	}): Promise<string[]> {
	const displayValues = context?.displayValues ?? suggestedValues;
	// Route to a remote interactive session (Raycast) when one is driving.
	const provider = runtime.executor?.promptProvider;
	if (provider) {
		return await provider.suggesterMulti(displayValues, suggestedValues, {
			placeholder: context?.placeholder,
			allowCustomInput,
		});
	}
	runtime.assertInteractivePrompt(
		context?.variableKey
			? `{{VALUE:${context.variableKey}}}`
			: "a multi-select value",
	);
	try {
		return await MultiSuggester.Suggest(
			runtime.app,
			displayValues,
			suggestedValues,
			{
				...(context?.placeholder
					? { placeholder: context.placeholder }
					: {}),
				allowCustomValue: allowCustomInput,
				...(context?.optional ? { skippable: true } : {}),
			},
		);
	} catch (error) {
		if (isCancellationError(error)) {
			throw new UserCancelError("Input cancelled by user");
		}
		throw error;
	}
}
