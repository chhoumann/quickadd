import { Formatter } from "./formatter";
import type { App } from "obsidian";
import { getNaturalLanguageDates } from "../utilityObsidian";
import type QuickAdd from "../main";
import { SingleTemplateEngine } from "../engine/SingleTemplateEngine";
import { DATE_VARIABLE_REGEX } from "../constants";

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
		return "_value_";
	}

	protected getVariableValue(variableName: string): string {
		return variableName;
	}

	protected getCurrentFileLink() {
		return this.app.workspace.getActiveFile()?.path ?? "_noPageOpen_";
	}

	protected getNaturalLanguageDates() {
		return getNaturalLanguageDates(this.app);
	}

	protected suggestForValue(suggestedValues: string[]) {
		return "_suggest_";
	}

	protected getMacroValue(macroName: string) {
		return `_macro: ${macroName}_`;
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("_math_");
	}

	protected promptForVariable(variableName: string): Promise<string> {
		return Promise.resolve(`${variableName}_`);
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
		return "_selected_";
	}

	protected async suggestForField(variableName: string) {
		return Promise.resolve(`_field: ${variableName}_`);
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
				formattedExample = this.generateDateFormatPreview(cleanDateFormat, previewDate);
			} catch (error) {
				// Fallback to showing the format pattern
				formattedExample = `[${cleanDateFormat} format]`;
			}
			
			return `${formattedExample} (${cleanVariableName})`;
		});
		
		return output;
	}
	
	private generateDateFormatPreview(format: string, date: Date): string {
		// Simple format preview generator for common patterns
		const year = date.getFullYear();
		const month = (date.getMonth() + 1).toString().padStart(2, '0');
		const day = date.getDate().toString().padStart(2, '0');
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
						   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const monthName = monthNames[date.getMonth()];
		
		// Handle common format patterns - order matters!
		return format
			.replace(/YYYY/g, year.toString())
			.replace(/YY/g, year.toString().slice(-2))
			.replace(/MMM/g, monthName) // Do MMM before MM to avoid double replacement
			.replace(/MM/g, month)
			.replace(/M/g, (date.getMonth() + 1).toString())
			.replace(/DD/g, day)
			.replace(/D/g, date.getDate().toString())
			// Add more format patterns as needed
			.replace(/[HhmsS]+/g, '12'); // Simple time placeholder
	}
}
