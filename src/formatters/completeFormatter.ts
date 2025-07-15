
import { Formatter } from "./formatter";
import type { App } from "obsidian";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type QuickAdd from "../main";
import { SingleMacroEngine } from "../engine/SingleMacroEngine";
import { SingleTemplateEngine } from "../engine/SingleTemplateEngine";
import { MarkdownView } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { INLINE_JAVASCRIPT_REGEX } from "../constants";
import { SingleInlineScriptEngine } from "../engine/SingleInlineScriptEngine";
import { MathModal } from "../gui/MathModal";
import InputPrompt from "../gui/InputPrompt";
import GenericInputPrompt from "src/gui/GenericInputPrompt/GenericInputPrompt";
import VDateInputPrompt from "src/gui/VDateInputPrompt/VDateInputPrompt";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import { FieldSuggestionParser, type FieldFilter } from "../utils/FieldSuggestionParser";

import { DataviewIntegration } from "../utils/DataviewIntegration";
import { EnhancedFieldSuggestionFileFilter } from "../utils/EnhancedFieldSuggestionFileFilter";
import { log } from "../logger/logManager";
import { InlineFieldParser } from "../utils/InlineFieldParser";
import { FieldSuggestionCache } from "../utils/FieldSuggestionCache";
import { FieldValueProcessor } from "../utils/FieldValueProcessor";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";

export class CompleteFormatter extends Formatter {
	private valueHeader: string;

	constructor(
		protected app: App,
		private plugin: QuickAdd,
		protected choiceExecutor?: IChoiceExecutor,
		dateParser?: IDateParser
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
		output = await this.replaceDateVariableInString(output);
		output = await this.replaceVariableInString(output);
		output = await this.replaceFieldVarInString(output);
		output = await this.replaceMathValueInString(output);

		return output;
	}

	async formatFileName(input: string, valueHeader: string): Promise<string> {
		this.valueHeader = valueHeader;
		return await this.format(input);
	}

	async formatFileContent(input: string): Promise<string> {
		let output: string = input;

		output = await this.format(output);
		output = await this.replaceLinkToCurrentFileInString(output);

		return output;
	}

	async formatFolderPath(folderName: string): Promise<string> {
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
		context?: { type?: string; dateFormat?: string }
	): Promise<string> {
		// Use VDateInputPrompt for VDATE variables
		if (context?.type === "VDATE" && context.dateFormat) {
			return await VDateInputPrompt.Prompt(
				this.app,
				header as string,
				"Enter a date (e.g., 'tomorrow', 'next friday', '2025-12-25')",
				undefined,
				context.dateFormat
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

		// Generate cache key based on filters
		const cacheKey = this.generateCacheKey(filters);
		const cache = FieldSuggestionCache.getInstance();

		// Check cache first
		let rawValues = cache.get(fieldName, cacheKey);

		if (!rawValues) {
			// Cache miss, collect values
			rawValues = new Set<string>();

			// Try to use Dataview if available and no inline filter is specified
			// (Dataview handles both YAML and inline fields automatically)
			if (!filters.inline && DataviewIntegration.isAvailable(this.app)) {
				rawValues = await DataviewIntegration.getFieldValuesWithFilter(
					this.app,
					fieldName,
					filters.folder,
					filters.tags,
					filters.excludeFolders,
					filters.excludeTags
				);
				// Dataview could not find anything or threw – fall back
				if (rawValues.size === 0) {
					rawValues = await this.collectValuesManually(fieldName, filters);
				}
			} else {
				rawValues = await this.collectValuesManually(fieldName, filters);
			}

			// Store in cache
			cache.set(fieldName, rawValues, cacheKey);
		}

		// Process values with deduplication and defaults
		const processedResult = FieldValueProcessor.processValues(
			rawValues,
			filters,
		);

		if (processedResult.values.length === 0) {
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
		if (processedResult.hasDefaultValue) {
			placeholder = `Enter value for ${fieldName} (default: ${filters.defaultValue})`;
		}

		return await InputSuggester.Suggest(
			this.app,
			processedResult.values,
			processedResult.values,
			{
				placeholder,
			},
		);
	}

	private generateCacheKey(filters: FieldFilter): string {
		const parts: string[] = [];
		if (filters.folder) parts.push(`folder:${filters.folder}`);
		if (filters.tags) parts.push(`tags:${filters.tags.join(",")}`);
		if (filters.inline) parts.push("inline:true");
		if (filters.caseSensitive) parts.push("case-sensitive:true");
		if (filters.excludeFolders)
			parts.push(`exclude-folders:${filters.excludeFolders.join(",")}`);
		if (filters.excludeTags)
			parts.push(`exclude-tags:${filters.excludeTags.join(",")}`);
		if (filters.excludeFiles)
			parts.push(`exclude-files:${filters.excludeFiles.join(",")}`);
		if (filters.defaultValue) parts.push(`default:${filters.defaultValue}`);
		if (filters.defaultEmpty) parts.push("default-empty:true");
		if (filters.defaultAlways) parts.push("default-always:true");
		return parts.join("|");
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

	private async collectValuesManually(fieldName: string, filters: FieldFilter): Promise<Set<string>> {
		const rawValues = new Set<string>();
		
		// Get all markdown files and apply enhanced filtering
		let files = this.app.vault.getMarkdownFiles();
		files = EnhancedFieldSuggestionFileFilter.filterFiles(
			files,
			filters,
			(file) => this.app.metadataCache.getFileCache(file),
		);

		// Process files in batches for better performance
		const batchSize = 50;
		for (let i = 0; i < files.length; i += batchSize) {
			const batch = files.slice(i, i + batchSize);
			const promises = batch.map(async (file) => {
				const values = new Set<string>();
				
				try {
					const metadataCache = this.app.metadataCache.getFileCache(file);

					// Get values from YAML frontmatter
					const value: unknown = metadataCache?.frontmatter?.[fieldName];
					if (value !== undefined && value !== null) {
						if (Array.isArray(value)) {
							value.forEach((x) => {
								const strValue = String(x).trim();
								if (strValue) values.add(strValue);
							});
						} else if (typeof value !== "object") {
							const strValue = String(value).trim();
							if (strValue) values.add(strValue);
						}
					}

					// Get values from inline fields if requested
					if (filters.inline) {
						try {
							const content = await this.app.vault.read(file);
							const inlineValues = InlineFieldParser.getFieldValues(
								content,
								fieldName,
							);
							inlineValues.forEach((v) => values.add(v));
						} catch (error) {
							// Skip files that can't be read (binary files, permissions, etc.)
							log.logWarning(`Could not read file ${file.path} for inline field parsing: ${error}`);
						}
					}
				} catch (error) {
					// Skip files with metadata cache issues
					log.logWarning(`Could not process metadata for file ${file.path}: ${error}`);
				}

				return values;
			});

			const batchResults = await Promise.all(promises);
			for (const values of batchResults) {
				for (const v of values) {
					rawValues.add(v);
				}
			}
		}

		return rawValues;
	}

}
