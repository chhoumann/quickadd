import type { App } from "obsidian";
import { MarkdownView } from "obsidian";
import GenericInputPrompt from "src/gui/GenericInputPrompt/GenericInputPrompt";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import VDateInputPrompt from "src/gui/VDateInputPrompt/VDateInputPrompt";
import { INLINE_JAVASCRIPT_REGEX } from "../constants";
import { SingleInlineScriptEngine } from "../engine/SingleInlineScriptEngine";
import { SingleMacroEngine } from "../engine/SingleMacroEngine";
import { SingleTemplateEngine } from "../engine/SingleTemplateEngine";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import InputPrompt from "../gui/InputPrompt";
import { MathModal } from "../gui/MathModal";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";
import { DataviewIntegration } from "../utils/DataviewIntegration";
import { EnhancedFieldSuggestionFileFilter } from "../utils/EnhancedFieldSuggestionFileFilter";
import { FieldSuggestionCache } from "../utils/FieldSuggestionCache";
import {
	type FieldFilter,
	FieldSuggestionParser,
} from "../utils/FieldSuggestionParser";
import {
	collectFieldValuesProcessedDetailed,
	collectFieldValuesRaw,
	generateFieldCacheKey,
} from "../utils/FieldValueCollector";
import { FieldValueProcessor } from "../utils/FieldValueProcessor";
import { InlineFieldParser } from "../utils/InlineFieldParser";
import { Formatter } from "./formatter";

export class CompleteFormatter extends Formatter {
	private valueHeader: string;

	constructor(
		protected app: App,
		private plugin: QuickAdd,
		protected choiceExecutor?: IChoiceExecutor,
		dateParser?: IDateParser,
	) {
		super();
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

	async formatFileName(input: string, valueHeader: string): Promise<string> {
		// Check for {{title}} usage in filename which would cause infinite recursion
		if (/\{\{title\}\}/i.test(input)) {
			throw new Error(
				"{{title}} cannot be used in file names as it would create a circular dependency. The title is derived from the filename itself.",
			);
		}

		this.valueHeader = valueHeader;
		return await this.format(input);
	}

	async formatFileContent(input: string): Promise<string> {
		let output: string = input;

		output = await this.format(output);
		output = await this.replaceLinkToCurrentFileInString(output);
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

	protected getCurrentFileLink(): string | null {
		const currentFile = this.app.workspace.getActiveFile();
		if (!currentFile) return null;

		return this.app.fileManager.generateMarkdownLink(currentFile, "");
	}

	protected getVariableValue(variableName: string): string {
		return (this.variables.get(variableName) as string) ?? "";
	}

	protected async promptForValue(header?: string): Promise<string> {
		if (!this.value) {
			const selectedText: string = await this.getSelectedText();
			this.value = selectedText
				? selectedText
				: await new InputPrompt()
						.factory()
						.Prompt(this.app, this.valueHeader ?? `Enter value`);
		}

		return this.value;
	}

	protected async promptForVariable(
		header?: string,
		context?: { type?: string; dateFormat?: string; defaultValue?: string },
	): Promise<string> {
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
		return await new InputPrompt().factory().Prompt(this.app, header as string);
	}

	protected async promptForMathValue(): Promise<string> {
		return await MathModal.Prompt();
	}

	protected async suggestForValue(suggestedValues: string[]) {
		return await GenericSuggester.Suggest(
			this.app,
			suggestedValues,
			suggestedValues,
		);
	}

	protected async suggestForField(fieldInput: string) {
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
