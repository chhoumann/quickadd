import type { App } from "obsidian";
import { MarkdownView } from "obsidian";
import GenericInputPrompt from "src/gui/GenericInputPrompt/GenericInputPrompt";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import VDateInputPrompt from "src/gui/VDateInputPrompt/VDateInputPrompt";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { GLOBAL_VAR_REGEX, INLINE_JAVASCRIPT_REGEX } from "../constants";
import { SingleInlineScriptEngine } from "../engine/SingleInlineScriptEngine";
import { SingleMacroEngine } from "../engine/SingleMacroEngine";
import { SingleTemplateEngine } from "../engine/SingleTemplateEngine";
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
import { Formatter } from "./formatter";
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
		return output;
	}

	async formatFileContent(input: string): Promise<string> {
		let output: string = input;

		output = await this.format(output);
		output = await this.replaceLinkToCurrentFileInString(output);
		output = await this.replaceCurrentFileNameInString(output);
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

		return await this.format(folderName);
	}

	/**
	 * Formats small inline target strings used for location matching, e.g.,
	 * the "Insert after" selector. This intentionally does not run Templater,
	 * but applies the core QuickAdd format pipeline plus link/title expansion
	 * so selectors can reference {{linkcurrent}} and {{title}} consistently.
	 */
	protected async formatLocationString(input: string): Promise<string> {
		let output = await this.format(input);
		output = await this.replaceLinkToCurrentFileInString(output);
		output = await this.replaceCurrentFileNameInString(output);
		output = this.replaceTitleInString(output);
		return output;
	}

	protected getCurrentFileLink(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		const sourcePath = currentFile.path;
		return this.app.fileManager.generateMarkdownLink(currentFile, sourcePath);
	}

	protected getCurrentFileName(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		return currentFile.basename;
	}

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	protected async promptForValue(header?: string): Promise<string> {
		if (!this.value) {
			const selectedText: string = await this.getSelectedText();
			if (selectedText) {
				this.value = selectedText;
			} else {
				try {
					this.value = await new InputPrompt()
						.factory()
						.Prompt(this.app, this.valueHeader ?? `Enter value`);
				} catch (error) {
					if (isCancellationError(error)) {
						throw new MacroAbortError("Input cancelled by user");
					}
					throw error;
				}
			}
		}

		return this.value;
	}

	protected async promptForVariable(
		header?: string,
		context?: { type?: string; dateFormat?: string; defaultValue?: string },
	): Promise<string> {
		try {
			// Use VDateInputPrompt for VDATE variables
			if (context?.type === "VDATE" && context.dateFormat) {
				return await VDateInputPrompt.Prompt(
					this.app,
					header as string,
					"Enter a date (e.g., 'tomorrow', 'next friday', '2025-12-25')",
					context.defaultValue,
					context.dateFormat,
				);
			}

			// Use default prompt for other variables
			return await new InputPrompt().factory().Prompt(
			this.app,
			header as string,
			context?.defaultValue ? context.defaultValue : undefined,
			context?.defaultValue
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

	protected async suggestForValue(suggestedValues: string[], allowCustomInput = false) {
		try {
			if (allowCustomInput) {
				return await InputSuggester.Suggest(
					this.app,
					suggestedValues,
					suggestedValues,
				);
			}
			return await GenericSuggester.Suggest(
				this.app,
				suggestedValues,
				suggestedValues,
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

				return await GenericInputPrompt.Prompt(
					this.app,
					`Enter value for ${fieldName}`,
					fallbackPrompt,
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

	protected async getMacroValue(macroName: string): Promise<string> {
		const macroEngine: SingleMacroEngine = new SingleMacroEngine(
			this.app,
			this.plugin,
			this.plugin.settings.choices,
			//@ts-ignore
			this.choiceExecutor,
			this.variables,
		);
		const macroOutput = (await macroEngine.runAndGetOutput(macroName)) ?? "";

		// Copy variables from macro execution
		macroEngine.getVariables().forEach((value, key) => {
			this.variables.set(key, value);
		});

		return macroOutput;
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		return await new SingleTemplateEngine(
			this.app,
			this.plugin,
			templatePath,
			this.choiceExecutor,
		).run();
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
