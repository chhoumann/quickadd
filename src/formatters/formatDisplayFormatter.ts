import { Formatter } from "./formatter";
import type { App } from "obsidian";
import type QuickAdd from "../main";
import { SingleTemplateEngine } from "../engine/SingleTemplateEngine";
import { DATE_VARIABLE_REGEX, GLOBAL_VAR_REGEX } from "../constants";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";
import {
	getVariableExample,
	getMacroPreview,
	getVariablePromptExample,
	getSuggestionPreview,
	getCurrentFileLinkPreview,
	DateFormatPreviewGenerator
} from "./helpers/previewHelpers";

export class FormatDisplayFormatter extends Formatter {
	constructor(
		private app: App, 
		private plugin: QuickAdd,
		dateParser?: IDateParser
	) {
		super();
		this.dateParser = dateParser || NLDParser;
	}

	public async format(input: string): Promise<string> {
		let output: string = input;

		try {
			// Expand global variables first so previews include their content
			output = await this.replaceGlobalVarInString(output);
			output = this.replaceDateInString(output);
			output = this.replaceTimeInString(output);
			output = await this.replaceValueInString(output);
			output = await this.replaceSelectedInString(output);
			output = await this.replaceClipboardInString(output);
			output = await this.replaceDateVariableInString(output);
			output = await this.replaceVariableInString(output);
			output = await this.replaceLinkToCurrentFileInString(output);
			output = await this.replaceMacrosInString(output);
			output = await this.replaceTemplateInString(output);
			output = await this.replaceFieldVarInString(output);
			output = this.replaceRandomInString(output);
			output = this.replaceLinebreakInString(output);
		} catch {
			// Return the input as-is if formatting fails during preview
			// This prevents crashes when typing incomplete syntax
			return input;
		}

		return output;
	}

	protected async replaceGlobalVarInString(input: string): Promise<string> {
		let output = input;
		let guard = 0;
		const re = new RegExp(GLOBAL_VAR_REGEX.source, 'gi');
		while (re.test(output)) {
			if (++guard > 5) break;
			output = output.replace(re, (_m, rawName) => {
				const name = String(rawName ?? '').trim();
				if (!name) return _m;
				const snippet = this.plugin?.settings?.globalVariables?.[name];
				return typeof snippet === 'string' ? snippet : '';
			});
		}
		return output;
	}
	protected promptForValue(header?: string): string {
		return header || "user input";
	}

	protected getVariableValue(variableName: string): string {
		return getVariableExample(variableName);
	}

	protected getCurrentFileLink() {
		return getCurrentFileLinkPreview(this.app.workspace.getActiveFile());
	}

	protected suggestForValue(suggestedValues: string[]) {
		return getSuggestionPreview(suggestedValues);
	}

	protected getMacroValue(macroName: string) {
		return getMacroPreview(macroName);
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("calculation_result");
	}

	protected promptForVariable(
		variableName: string,
		context?: { type?: string; dateFormat?: string; defaultValue?: string }
	): Promise<string> {
		return Promise.resolve(getVariablePromptExample(variableName));
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		try {
			return await new SingleTemplateEngine(
				this.app,
				this.plugin,
				templatePath,
				undefined
			).run();
		} catch {
			return `Template (not found): ${templatePath}`;
		}
	}

	 
	protected async getSelectedText(): Promise<string> {
		return "selected_text";
	}

	protected async getClipboardContent(): Promise<string> {
		return "clipboard_content";
	}

	protected async suggestForField(variableName: string) {
		return Promise.resolve(`${variableName}_field_value`);
	}

	protected async replaceDateVariableInString(input: string): Promise<string> {
		let output: string = input;
		
		// For preview, show helpful format examples instead of failing
		output = output.replace(new RegExp(DATE_VARIABLE_REGEX.source, 'gi'), (match, variableName, dateFormat, defaultValue) => {
			const cleanVariableName = variableName?.trim();
			const cleanDateFormat = dateFormat?.trim();
			const cleanDefaultValue = defaultValue?.trim();
			
			if (!cleanVariableName || !cleanDateFormat) {
				return match; // Return original if incomplete
			}

			// Generate a preview using current date with the specified format
			const previewDate = new Date();
			let formattedExample: string;
			
			try {
				// Try to generate a realistic preview using the format
				formattedExample = DateFormatPreviewGenerator.generate(cleanDateFormat, previewDate);
			} catch {
				// Fallback to showing the format pattern
				formattedExample = `[${cleanDateFormat} format]`;
			}
			
			// If there's a default value, indicate it in the preview
			if (cleanDefaultValue) {
				formattedExample += ` (default: ${cleanDefaultValue})`;
			}
			
			return formattedExample;
		});
		
		return output;
	}

	protected replaceRandomInString(input: string): string {
		let output = input;
		
		// Replace {{RANDOM:n}} with a preview showing example output
		output = output.replace(/{{RANDOM:(\d+)}}/gi, (match, length) => {
			const len = parseInt(length);
			if (len <= 0 || len > 100) {
				return match; // Return original if invalid
			}
			
			// Generate a preview random string
			const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
			let preview = '';
			for (let i = 0; i < Math.min(len, 8); i++) {
				preview += chars.charAt(Math.floor(Math.random() * chars.length));
			}
			
			// For long strings, show truncated preview
			if (len > 8) {
				preview += `... (${len} chars)`;
			}
			
			return preview;
		});
		
		return output;
	}

	protected isYamlStructuredVariablesEnabled(): boolean {
		return false; // Preview formatter doesn't need structured YAML variable handling
	}
}
