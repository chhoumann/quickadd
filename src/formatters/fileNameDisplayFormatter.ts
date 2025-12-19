import { Formatter } from "./formatter";
import type { App } from "obsidian";
import { DATE_VARIABLE_REGEX, GLOBAL_VAR_REGEX } from "../constants";
import type { IDateParser } from "../parsers/IDateParser";
import { NLDParser } from "../parsers/NLDParser";
import {
	getVariableExample,
	getMacroPreview,
	getVariablePromptExample,
	getSuggestionPreview,
	getCurrentFileLinkPreview,
	getCurrentFileNamePreview,
	DateFormatPreviewGenerator
} from "./helpers/previewHelpers";
import { VALUE_LABEL_KEY_DELIMITER } from "../utils/valueSyntax";

import type QuickAdd from "../main";

export class FileNameDisplayFormatter extends Formatter {
	constructor(
		app: App,
		private readonly plugin?: QuickAdd,
		dateParser?: IDateParser,
	) {
		super(app);
		this.dateParser = dateParser || NLDParser;
	}

	public async format(input: string): Promise<string> {
		let output: string = input;

		try {
			// Expand globals first to preview inserted snippets
			output = await this.replaceGlobalVarInString(output);
			output = await this.replaceMacrosInString(output);
			output = this.replaceDateInString(output);
			output = this.replaceTimeInString(output);
			output = await this.replaceValueInString(output);
			output = await this.replaceSelectedInString(output);
			output = await this.replaceClipboardInString(output);
			output = await this.replaceDateVariableInString(output);
			output = await this.replaceVariableInString(output);
			output = await this.replaceFieldVarInString(output);
			output = await this.replaceCurrentFileNameInString(output);
			output = this.replaceRandomInString(output);
		} catch {
			// Return the input as-is if formatting fails during preview
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
		const stored = this.variables.get(variableName);
		if (typeof stored === "string") return stored;
		const baseName =
			variableName.split(VALUE_LABEL_KEY_DELIMITER)[0] ?? variableName;
		return getVariableExample(baseName);
	}

	protected getCurrentFileLink(): string | null {
		if (!this.app) return null;
		return getCurrentFileLinkPreview(this.app.workspace.getActiveFile());
	}

	protected getCurrentFileName(): string | null {
		if (!this.app) return "current_filename";
		return getCurrentFileNamePreview(this.app.workspace.getActiveFile());
	}

	protected suggestForValue(
		suggestedValues: string[],
		allowCustomInput = false,
		_context?: { placeholder?: string; variableKey?: string },
	) {
		return getSuggestionPreview(suggestedValues);
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("calculation_result");
	}

	protected getMacroValue(
		macroName: string,
		_context?: { label?: string },
	) {
		return getMacroPreview(macroName);
	}

	protected async promptForVariable(
		variableName: string,
		context?: {
			type?: string;
			dateFormat?: string;
			defaultValue?: string;
			label?: string;
			description?: string;
			placeholder?: string;
			variableKey?: string;
		}
	): Promise<string> {
		return getVariablePromptExample(variableName);
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		// Show template preview with realistic content length
		const templateName = templatePath.split('/').pop()?.replace('.md', '') || templatePath;
		return `[${templateName} template content...]`;
	}

	protected async getSelectedText(): Promise<string> {
		return "selected_text";
	}

	protected async getClipboardContent(): Promise<string> {
		return "clipboard_content";
	}

	protected async suggestForField(variableName: string): Promise<string> {
		return `${variableName}_field_value`;
	}

	protected async replaceDateVariableInString(input: string): Promise<string> {
		let output: string = input;
		
		// Enhanced date variable preview with realistic examples
		output = output.replace(new RegExp(DATE_VARIABLE_REGEX.source, 'gi'), (match, variableName, dateFormat) => {
			const cleanVariableName = variableName?.trim();
			const cleanDateFormat = dateFormat?.trim();
			
			if (!cleanVariableName || !cleanDateFormat) {
				return match; // Return original if incomplete
			}

			// Generate a realistic preview using current date
			const previewDate = new Date();
			let formattedExample: string;
			
			try {
				formattedExample = DateFormatPreviewGenerator.generate(cleanDateFormat, previewDate);
			} catch {
				formattedExample = `[${cleanDateFormat}]`;
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
			
			// For filename preview, show a simple example
			const exampleChars = 'ABC123';
			let preview = '';
			for (let i = 0; i < Math.min(len, 6); i++) {
				preview += exampleChars.charAt(i % exampleChars.length);
			}
			
			// For long strings, show ellipsis
			if (len > 6) {
				preview += '...';
			}
			
			return preview;
		});
		
		return output;
	}

	protected isTemplatePropertyTypesEnabled(): boolean {
		return false; // Not applicable for filename display
	}
}
