/* eslint-disable @typescript-eslint/require-await */
import { Formatter } from "./formatter";
import type { App } from "obsidian";
import { getNaturalLanguageDates } from "../utilityObsidian";
import { DATE_VARIABLE_REGEX } from "../constants";
import {
	getVariableExample,
	getMacroPreview,
	getVariablePromptExample,
	getSuggestionPreview,
	getCurrentFileLinkPreview,
	DateFormatPreviewGenerator
} from "./helpers/previewHelpers";

export class FileNameDisplayFormatter extends Formatter {
	constructor(private app: App) {
		super();
	}

	public async format(input: string): Promise<string> {
		let output: string = input;

		try {
			output = await this.replaceMacrosInString(output);
			output = this.replaceDateInString(output);
			output = this.replaceTimeInString(output);
			output = await this.replaceValueInString(output);
			output = await this.replaceDateVariableInString(output);
			output = await this.replaceVariableInString(output);
			output = await this.replaceFieldVarInString(output);
		} catch (error) {
			// Return the input as-is if formatting fails during preview
			return input;
		}

		return `Preview: ${output}`;
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

	protected getNaturalLanguageDates() {
		return getNaturalLanguageDates(this.app);
	}

	protected suggestForValue(suggestedValues: string[]) {
		return getSuggestionPreview(suggestedValues);
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("calculation_result");
	}

	protected getMacroValue(macroName: string) {
		return getMacroPreview(macroName);
	}

	protected async promptForVariable(variableName: string): Promise<string> {
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

	protected suggestForField(variableName: string) {
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
			} catch (error) {
				formattedExample = `[${cleanDateFormat}]`;
			}
			
			return formattedExample;
		});
		
		return output;
	}
}
