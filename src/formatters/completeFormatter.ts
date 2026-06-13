import type { App } from "obsidian";
import { MarkdownView } from "obsidian";
import GenericInputPrompt from "src/gui/GenericInputPrompt/GenericInputPrompt";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import VDateInputPrompt from "src/gui/VDateInputPrompt/VDateInputPrompt";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { GLOBAL_VAR_REGEX, INLINE_JAVASCRIPT_REGEX } from "../constants";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import InputPrompt from "../gui/InputPrompt";
import { MathModal } from "../gui/MathModal";
import type QuickAdd from "../main";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";
import {
	FieldSuggestionParser,
	type FieldFilter,
} from "../utils/FieldSuggestionParser";
import {
	collectFieldValuesProcessedDetailed,
	collectFieldValuesRaw,
	generateFieldCacheKey,
} from "../utils/FieldValueCollector";
import { FieldValueProcessor } from "../utils/FieldValueProcessor";
import { Formatter, type PromptContext } from "./formatter";
import { MacroAbortError } from "../errors/MacroAbortError";
import { isCancellationError } from "../utils/errorUtils";

export class CompleteFormatter extends Formatter {
	private valueHeader: string;

	constructor(
		protected app: App,
		private plugin: QuickAdd,
		protected choiceExecutor?: IChoiceExecutor,
		dateParser?: IDateParser,
	) {
		super(app);
		this.dateParser = dateParser || NLDParser;
		if (choiceExecutor) {
			this.variables = choiceExecutor?.variables;
		}
	}

	protected async format(input: string): Promise<string> {
		let output: string = input;

		output = await this.replaceInlineJavascriptInString(output);
		output = await this.replaceMacrosInString(output);
		output = await this.replaceTemplateInString(output);
		// Expand global variables early so injected snippets can be further formatted
		output = await this.replaceGlobalVarInString(output);
		output = this.replaceDateInString(output);
		output = this.replaceTimeInString(output);
		output = await this.replaceValueInString(output);
		output = await this.replaceSelectedInString(output);
		output = await this.replaceClipboardInString(output);
		output = await this.replaceDateVariableInString(output);
		output = await this.replaceVariableInString(output);
		output = await this.replaceFieldVarInString(output);
		output = await this.replaceMathValueInString(output);
		output = this.replaceRandomInString(output);

		return output;
	}

	protected async replaceGlobalVarInString(input: string): Promise<string> {
		let output = input;
		// Allow nested globals up to a small recursion limit
		let guard = 0;
		const re = new RegExp(GLOBAL_VAR_REGEX.source, "gi");
		while (re.test(output)) {
			if (++guard > 5) break;
			output = output.replace(re, (_m, rawName) => {
				const name = String(rawName ?? "").trim();
				if (!name) return _m;
				const snippet = this.plugin?.settings?.globalVariables?.[name];
				return typeof snippet === "string" ? snippet : "";
			});
		}
		return output;
	}

	async formatFileName(input: string, valueHeader: string): Promise<string> {
		// Check for {{title}} usage in filename which would cause infinite recursion
		if (/\{\{title\}\}/i.test(input)) {
			throw new Error(
				"{{title}} cannot be used in file names as it would create a circular dependency. The title is derived from the filename itself.",
			);
		}

		this.valueHeader = valueHeader;
		let output = await this.format(input);
		output = await this.replaceCurrentFileNameInString(output);
		output = this.replaceTargetFolderInString(output);
		return output;
	}

	async formatFileContent(input: string): Promise<string> {
		let output: string = input;

		output = await this.format(output);
		output = await this.replaceLinkToCurrentFileInString(output);
		output = await this.replaceCurrentFileNameInString(output);
		output = this.replaceTargetFolderInString(output);
		output = this.replaceTitleInString(output);

		return output;
	}

	async formatFolderPath(folderName: string): Promise<string> {
		// Check for {{title}} usage in folder path which would cause issues
		if (/\{\{title\}\}/i.test(folderName)) {
			throw new Error(
				"{{title}} cannot be used in folder paths as it would create a circular dependency. The title is derived from the filename itself.",
			);
		}

		// {{FOLDER}} in a folder definition is self-referential: the target
		// folder isn't known while folders are being resolved, so it collapses
		// to an empty string rather than leaking the literal token into a path.
		return this.replaceTargetFolderInString(await this.format(folderName));
	}

	/**
	 * Resolves QuickAdd format tokens inside a *template source path*, so a
	 * choice can point at e.g. "Templates/{{value:type}} Template.md" (issue
	 * #620). This is deliberately a PATH-SAFE subset of {@link format}: it
	 * resolves value/date/time/field/global/selected/clipboard/random/math
	 * tokens, but never runs macros, inline JavaScript, or {{TEMPLATE:}}
	 * inclusion — a file-path lookup should not execute code or splice another
	 * template's body into a path. Note-relative tokens ({{title}}, {{FOLDER}},
	 * {{FILENAMECURRENT}}, {{LINKCURRENT}}) are intentionally left literal: a
	 * source template has no "current note" or target folder, so an unresolved
	 * token fails visibly instead of silently collapsing the path.
	 *
	 * Resolve once at the engine entry and thread the result downward; the
	 * resolved path then feeds BOTH the target file's extension/name and the
	 * content read, so they can never disagree (e.g. a token that expands to
	 * `.canvas`). Do not re-run this on an already-resolved path — tokens like
	 * {{date}} / {{random}} would re-evaluate to a different value.
	 */
	async formatTemplateFilePath(input: string): Promise<string> {
		if (/\{\{title\}\}/i.test(input)) {
			throw new Error(
				"{{title}} cannot be used in a template path — the title is derived from the created file, not the source template.",
			);
		}

		let output = input;
		// Expand globals first so an injected snippet's path-safe tokens resolve.
		output = await this.replaceGlobalVarInString(output);
		output = this.replaceDateInString(output);
		output = this.replaceTimeInString(output);
		output = await this.replaceValueInString(output);
		output = await this.replaceSelectedInString(output);
		output = await this.replaceClipboardInString(output);
		output = await this.replaceDateVariableInString(output);
		output = await this.replaceVariableInString(output);
		output = await this.replaceFieldVarInString(output);
		output = await this.replaceMathValueInString(output);
		output = this.replaceRandomInString(output);

		// A global variable can itself expand to "{{title}}", slipping past the
		// up-front guard; catch it here so the user gets the clear circular-title
		// error rather than a confusing "template not found".
		if (/\{\{title\}\}/i.test(output)) {
			throw new Error(
				"{{title}} cannot be used in a template path — the title is derived from the created file, not the source template.",
			);
		}

		// Trim so the suffix the engine reads for the extension matches the path
		// getTemplateFile ultimately resolves (which trims) — otherwise a token
		// that leaves trailing whitespace could split the two.
		return output.trim();
	}

	/**
	 * Formats small inline target strings used for location matching, e.g.,
	 * the line-target capture selectors. This intentionally does not run Templater,
	 * but applies the core QuickAdd format pipeline plus link/title expansion
	 * so selectors can reference {{linkcurrent}} and {{title}} consistently.
	 */
	protected async formatLocationString(input: string): Promise<string> {
		let output = await this.format(input);
		output = await this.replaceLinkToCurrentFileInString(output);
		output = await this.replaceCurrentFileNameInString(output);
		// Note: {{FOLDER}} is deliberately NOT resolved in location selectors
		// (insert-after/before targets) — an empty resolution would match the
		// first line, and folder reflection isn't meaningful for a line target.
		output = this.replaceTitleInString(output);
		return output;
	}

	protected getLinkSourcePath(): string | null {
		return null;
	}

	protected getCurrentFileLink(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		return this.app.fileManager.generateMarkdownLink(currentFile, "");
	}

	protected getCurrentFileName(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		return currentFile.basename;
	}

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	protected shouldUseSelectionForValue(): boolean {
		return true;
	}

	protected async getSelectedTextForValue(): Promise<string> {
		return await this.getSelectedText();
	}

	protected async promptForValue(header?: string): Promise<string> {
		if (this.value === undefined) {
			if (this.shouldUseSelectionForValue()) {
				const selectedText: string = await this.getSelectedTextForValue();
				if (selectedText) {
					this.value = selectedText;
					return this.value;
				}
			}
			try {
				const linkSourcePath = this.getLinkSourcePath();
				const promptFactory = new InputPrompt().factory(
					this.valuePromptContext?.inputTypeOverride,
				);
				const defaultValue = this.valuePromptContext?.defaultValue;
				const description = this.valuePromptContext?.description;
				const promptOptions = this.valuePromptContext?.optional
					? { optional: true }
					: undefined;
				if (linkSourcePath) {
					this.value = await promptFactory.PromptWithContext(
						this.app,
						this.valueHeader ?? `Enter value`,
						undefined,
						defaultValue,
						linkSourcePath,
						description,
						promptOptions,
					);
				} else {
					this.value = await promptFactory.Prompt(
						this.app,
						this.valueHeader ?? `Enter value`,
						undefined,
						defaultValue,
						description,
						promptOptions,
					);
				}
			} catch (error) {
				if (isCancellationError(error)) {
					throw new MacroAbortError("Input cancelled by user");
				}
				throw error;
			}
		}

		return this.value;
	}

	protected async promptForVariable(
		header?: string,
		context?: PromptContext,
	): Promise<string> {
		try {
			// Use VDateInputPrompt for VDATE variables
			if (context?.type === "VDATE") {
				return await VDateInputPrompt.Prompt(
					this.app,
					(header as string) ?? context.label ?? "Enter date",
					"Enter a date (e.g., 'tomorrow', 'next friday', '2025-12-25')",
					context.defaultValue,
					context.dateFormat ?? "YYYY-MM-DD",
					context.optional ? { optional: true } : undefined,
				);
			}

			// Use default prompt for other variables
			return await new InputPrompt().factory(context?.inputTypeOverride).Prompt(
				this.app,
				header ?? context?.label ?? "Enter value",
				context?.placeholder ??
					(context?.defaultValue ? context.defaultValue : undefined),
				context?.defaultValue,
				context?.description,
				context?.optional ? { optional: true } : undefined,
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new MacroAbortError("Input cancelled by user");
			}
			throw error;
		}
	}

	protected async promptForMathValue(): Promise<string> {
		try {
			return await MathModal.Prompt();
		} catch (error) {
			if (isCancellationError(error)) {
				throw new MacroAbortError("Input cancelled by user");
			}
			throw error;
		}
	}

	protected async suggestForValue(
		suggestedValues: string[],
		allowCustomInput = false,
		context?: {
			placeholder?: string;
			variableKey?: string;
			displayValues?: string[];
			optional?: boolean;
		},
	) {
		try {
			const displayValues = context?.displayValues ?? suggestedValues;
			if (allowCustomInput) {
				return await InputSuggester.Suggest(
					this.app,
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
				this.app,
				displayValues,
				suggestedValues,
				context?.placeholder,
				undefined,
				context?.optional ? { skippable: true } : undefined,
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new MacroAbortError("Input cancelled by user");
			}
			throw error;
		}
	}

	protected async suggestForField(fieldInput: string) {
		try {
			// Parse the field input to extract field name and filters
			const { fieldName, filters } = FieldSuggestionParser.parse(fieldInput);

			// Collect and process via shared collector
			const { values, hasDefaultValue } =
				await collectFieldValuesProcessedDetailed(this.app, fieldName, filters);

			if (values.length === 0) {
				// No values found even after processing defaults
				let fallbackPrompt = `No existing values were found in your vault.`;

				// Suggest smart defaults if no custom default was provided
				if (!filters.defaultValue) {
					const smartDefaults = FieldValueProcessor.getSmartDefaults(
						fieldName,
						[],
					);
					if (smartDefaults.length > 0) {
						fallbackPrompt += `\n\nSuggested values for ${fieldName}: ${smartDefaults.slice(0, 3).join(", ")}`;
					}
				}

				return await GenericInputPrompt.PromptWithContext(
				this.app,
				`Enter value for ${fieldName}`,
				fallbackPrompt,
				undefined,
				this.getLinkSourcePath() ?? undefined
				);
			}

			// Enhance placeholder with context
			let placeholder = `Enter value for ${fieldName}`;
			if (hasDefaultValue) {
				placeholder = `Enter value for ${fieldName} (default: ${filters.defaultValue})`;
			}

			return await InputSuggester.Suggest(this.app, values, values, {
				placeholder,
			});
		} catch (error) {
			if (isCancellationError(error)) {
				throw new MacroAbortError("Input cancelled by user");
			}
			throw error;
		}
	}

	private generateCacheKey(filters: FieldFilter): string {
		return generateFieldCacheKey(filters);
	}

	protected async getMacroValue(
		macroName: string,
		context?: { label?: string },
	): Promise<string> {
		// Imported lazily: a static import would re-create the
		// completeFormatter ⇄ engine circular dependency (#1249).
		const { SingleMacroEngine } = await import(
			"../engine/SingleMacroEngine"
		);
		const macroEngine = new SingleMacroEngine(
			this.app,
			this.plugin,
			this.plugin.settings.choices,
			//@ts-ignore
			this.choiceExecutor,
			this.variables,
		);
		const macroOutput =
			(await macroEngine.runAndGetOutput(macroName, context)) ?? "";

		// Copy variables from macro execution
		macroEngine.getVariables().forEach((value, key) => {
			this.variables.set(key, value);
		});

		return macroOutput;
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		// Imported lazily to avoid the completeFormatter ⇄ engine cycle (#1249).
		const { SingleTemplateEngine } = await import(
			"../engine/SingleTemplateEngine"
		);
		this.templateInclusion ??= { visited: new Set<string>(), depth: 0 };
		const childInclusion = {
			visited: this.templateInclusion.visited,
			depth: this.templateInclusion.depth + 1,
		};
		const childEngine = new SingleTemplateEngine(
			this.app,
			this.plugin,
			templatePath,
			this.choiceExecutor,
			childInclusion,
		);
		// Propagate the target folder so {{FOLDER}} resolves inside included
		// templates ({{TEMPLATE:...}}), which render via this child engine's own
		// formatter.
		childEngine.setTargetFolderPath(this.targetFolderPath);
		return await childEngine.run();
	}

	protected async getSelectedText(): Promise<string> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) return "";

		return activeView.editor.getSelection();
	}

	protected async getClipboardContent(): Promise<string> {
		try {
			return await navigator.clipboard.readText();
		} catch {
			// Fallback for when clipboard access fails (permissions, security context, etc.)
			return "";
		}
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return this.plugin.settings.enableTemplatePropertyTypes;
	}

	protected async replaceInlineJavascriptInString(input: string) {
		let output: string = input;

		while (INLINE_JAVASCRIPT_REGEX.test(output)) {
			const match = INLINE_JAVASCRIPT_REGEX.exec(output);
			const code = match?.at(1)?.trim();

			if (code) {
				// Imported lazily to avoid the completeFormatter ⇄ engine cycle (#1249).
				const { SingleInlineScriptEngine } = await import(
					"../engine/SingleInlineScriptEngine"
				);
				const executor = new SingleInlineScriptEngine(
					this.app,
					this.plugin,
					//@ts-ignore
					this.choiceExecutor,
					this.variables,
				);
				const outVal: unknown = await executor.runAndGetOutput(code);

				for (const key in executor.params.variables) {
					this.variables.set(key, executor.params.variables[key]);
				}

				output =
					typeof outVal === "string"
						? this.replacer(output, INLINE_JAVASCRIPT_REGEX, outVal)
						: this.replacer(output, INLINE_JAVASCRIPT_REGEX, "");
			} else {
				// Empty/whitespace-only fence (e.g. ```js quickadd\n```): consume the
				// matched block so the loop terminates instead of spinning forever.
				output = this.replacer(output, INLINE_JAVASCRIPT_REGEX, "");
			}
		}

		return output;
	}

	private async collectValuesManually(
		fieldName: string,
		filters: FieldFilter,
	): Promise<Set<string>> {
		return await collectFieldValuesRaw(this.app, fieldName, filters);
	}
}
