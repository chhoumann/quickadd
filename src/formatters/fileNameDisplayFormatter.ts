/* eslint-disable @typescript-eslint/require-await */
import { Formatter } from "./formatter";
import type { App } from "obsidian";
import { getNaturalLanguageDates } from "../utilityObsidian";
import { DATE_VARIABLE_REGEX } from "../constants";

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

		return `📄 ${output}`;
	}

	protected promptForValue(header?: string): string {
		return `💬 ${header || "user input"}`;
	}

	protected getVariableValue(variableName: string): string {
		// Return example values for common variable names
		const exampleValues: Record<string, string> = {
			"title": "My Document Title",
			"name": "Document Name", 
			"project": "Project Alpha",
			"category": "Notes",
			"author": "Your Name",
			"status": "Draft",
			"priority": "High",
			"tag": "important",
			"type": "meeting",
			"client": "Acme Corp"
		};
		
		const example = exampleValues[variableName.toLowerCase()];
		return example ? `📝 ${example}` : `📝 ${variableName}_example`;
	}

	protected getCurrentFileLink() {
		const activeFile = this.app.workspace.getActiveFile();
		return activeFile?.path ? `🔗 ${activeFile.basename}` : "🔗 current_file";
	}

	protected getNaturalLanguageDates() {
		return getNaturalLanguageDates(this.app);
	}

	protected suggestForValue(suggestedValues: string[]) {
		if (suggestedValues.length > 0) {
			return `📋 ${suggestedValues[0]} (${suggestedValues.length} options)`;
		}
		return "📋 suggestion_list";
	}

	protected promptForMathValue(): Promise<string> {
		return Promise.resolve("🧮 calculation_result");
	}

	protected getMacroValue(macroName: string) {
		// Show more descriptive macro previews
		const macroDescriptions: Record<string, string> = {
			"clipboard": "clipboard_content",
			"date": "formatted_date",
			"time": "current_time",
			"random": "random_value",
			"uuid": "unique_id"
		};
		
		const description = macroDescriptions[macroName.toLowerCase()] || `${macroName}_output`;
		return `⚙️ ${description}`;
	}

	protected async promptForVariable(variableName: string): Promise<string> {
		// Generate realistic example based on variable name patterns
		const patterns: Array<{pattern: RegExp, example: string}> = [
			{pattern: /date|time/i, example: "2024-01-15"},
			{pattern: /title|name/i, example: "Example Title"},
			{pattern: /tag/i, example: "important"},
			{pattern: /category|type/i, example: "Notes"},
			{pattern: /author|user/i, example: "Your Name"},
			{pattern: /project/i, example: "Project Alpha"},
			{pattern: /status/i, example: "In Progress"},
			{pattern: /priority/i, example: "High"},
			{pattern: /number|count|id/i, example: "001"}
		];
		
		for (const {pattern, example} of patterns) {
			if (pattern.test(variableName)) {
				return `💭 ${example}`;
			}
		}
		
		return `💭 ${variableName}_value`;
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		// Show template preview with realistic content length
		const templateName = templatePath.split('/').pop()?.replace('.md', '') || templatePath;
		return `📄 [${templateName} template content...]`;
	}

	protected async getSelectedText(): Promise<string> {
		return "✂️ selected_text";
	}

	protected suggestForField(variableName: string) {
		return `🏷️ ${variableName}_field_value`;
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
				formattedExample = this.generateDateFormatPreview(cleanDateFormat, previewDate);
			} catch (error) {
				formattedExample = `[${cleanDateFormat}]`;
			}
			
			return `📅 ${formattedExample}`;
		});
		
		return output;
	}

	private generateDateFormatPreview(format: string, date: Date): string {
		// Enhanced date format preview with more patterns
		const year = date.getFullYear();
		const month = (date.getMonth() + 1).toString().padStart(2, '0');
		const day = date.getDate().toString().padStart(2, '0');
		const hours = date.getHours().toString().padStart(2, '0');
		const minutes = date.getMinutes().toString().padStart(2, '0');
		const seconds = date.getSeconds().toString().padStart(2, '0');
		
		const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 
						   'July', 'August', 'September', 'October', 'November', 'December'];
		const monthNamesShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
								'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		const dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		
		// Handle common format patterns - order matters for longer patterns first!
		return format
			// Year patterns
			.replace(/YYYY/g, year.toString())
			.replace(/YY/g, year.toString().slice(-2))
			// Month patterns  
			.replace(/MMMM/g, monthNames[date.getMonth()])
			.replace(/MMM/g, monthNamesShort[date.getMonth()])
			.replace(/MM/g, month)
			.replace(/M/g, (date.getMonth() + 1).toString())
			// Day patterns
			.replace(/dddd/g, dayNames[date.getDay()])
			.replace(/ddd/g, dayNamesShort[date.getDay()])
			.replace(/DD/g, day)
			.replace(/D/g, date.getDate().toString())
			// Time patterns
			.replace(/HH/g, hours)
			.replace(/H/g, date.getHours().toString())
			.replace(/mm/g, minutes)
			.replace(/m/g, date.getMinutes().toString())
			.replace(/ss/g, seconds)
			.replace(/s/g, date.getSeconds().toString())
			// Week patterns
			.replace(/ww/g, this.getWeekNumber(date).toString().padStart(2, '0'))
			.replace(/w/g, this.getWeekNumber(date).toString());
	}

	private getWeekNumber(date: Date): number {
		const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
		const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
		return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
	}
}
