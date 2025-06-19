import { Formatter } from "./formatter";
import type { App } from "obsidian";
import { getNaturalLanguageDates } from "../utilityObsidian";
import type QuickAdd from "../main";
import { SingleTemplateEngine } from "../engine/SingleTemplateEngine";
import { DATE_VARIABLE_REGEX } from "../constants";
import {
	getVariableExample,
	getMacroPreview,
	getVariablePromptExample,
	getSuggestionPreview,
	getCurrentFileLinkPreview,
	DateFormatPreviewGenerator
} from "./helpers/previewHelpers";

export class FormatDisplayFormatter extends Formatter {
	constructor(private app: App, private plugin: QuickAdd) {
		super();
	}

	public async format(input: string): Promise<string> {
		let output: string = input;

		try {
			output = this.replaceDateInString(output);
			output = this.replaceTimeInString(output);
			output = await this.replaceValueInString(output);
			output = await this.replaceDateVariableInString(output);
			output = await this.replaceVariableInString(output);
			output = await this.replaceLinkToCurrentFileInString(output);
			output = await this.replaceMacrosInString(output);
			output = await this.replaceTemplateInString(output);
			output = await this.replaceFieldVarInString(output);
			output = this.replaceLinebreakInString(output);
		} catch (error) {
			// Return the input as-is if formatting fails during preview
			// This prevents crashes when typing incomplete syntax
			return input;
		}

		return output;
	}
	protected promptForValue(header?: string): string {
		return `💬 ${header || "user input"}`;
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

	protected getMacroValue(macroName: string) {
		return getMacroPreview(macroName);
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("🧮 calculation_result");
	}

	protected promptForVariable(variableName: string): Promise<string> {
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
		} catch (e) {
			return `Template (not found): ${templatePath}`;
		}
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	protected async getSelectedText(): Promise<string> {
		return "✂️ selected_text";
	}

	protected async suggestForField(variableName: string) {
		return Promise.resolve(`🏷️ ${variableName}_field_value`);
	}

	protected async replaceDateVariableInString(input: string): Promise<string> {
		let output: string = input;
		
		// For preview, show helpful format examples instead of failing
		output = output.replace(new RegExp(DATE_VARIABLE_REGEX.source, 'gi'), (match, variableName, dateFormat) => {
			const cleanVariableName = variableName?.trim();
			const cleanDateFormat = dateFormat?.trim();
			
			if (!cleanVariableName || !cleanDateFormat) {
				return match; // Return original if incomplete
			}

			// Generate a preview using current date with the specified format
			const previewDate = new Date();
			let formattedExample: string;
			
			try {
				// Try to generate a realistic preview using the format
				formattedExample = DateFormatPreviewGenerator.generate(cleanDateFormat, previewDate);
			} catch (error) {
				// Fallback to showing the format pattern
				formattedExample = `[${cleanDateFormat} format]`;
			}
			
			return `📅 ${formattedExample}`;
		});
		
		return output;
	}
}
