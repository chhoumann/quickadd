import {
	DATE_REGEX,
	DATE_REGEX_FORMATTED,
	DATE_VARIABLE_REGEX,
	LINK_TO_CURRENT_FILE_REGEX,
	MACRO_REGEX,
	MATH_VALUE_REGEX,
	NAME_VALUE_REGEX,
	NUMBER_REGEX,
	TEMPLATE_REGEX,
	VARIABLE_REGEX,

	FIELD_VAR_REGEX_WITH_FILTERS,
	SELECTED_REGEX,
	CLIPBOARD_REGEX,
	TIME_REGEX,
	TIME_REGEX_FORMATTED,
	TITLE_REGEX,
} from "../constants";
import { getDate } from "../utilityObsidian";
import type { IDateParser } from "../parsers/IDateParser";

export abstract class Formatter {
	protected value: string;
	protected variables: Map<string, unknown> = new Map<string, string>();
	protected dateParser: IDateParser | undefined;

	protected abstract format(input: string): Promise<string>;
	
	public setTitle(title: string): void {
		this.variables.set("title", title);
	}

	protected replacer(str: string, reg: RegExp, replaceValue: string) {
		return str.replace(reg, function () {
			return replaceValue;
		});
	}

	protected replaceDateInString(input: string) {
		let output: string = input;

		while (DATE_REGEX.test(output)) {
			const dateMatch = DATE_REGEX.exec(output);
			let offset: number | undefined;

			if (dateMatch && dateMatch[1]) {
				const offsetString = dateMatch[1].replace("+", "").trim();
				const offsetIsInt = NUMBER_REGEX.test(offsetString);
				if (offsetIsInt) offset = parseInt(offsetString);
			}
			output = this.replacer(output, DATE_REGEX, getDate({ offset: offset }));
		}

		while (DATE_REGEX_FORMATTED.test(output)) {
			const dateMatch = DATE_REGEX_FORMATTED.exec(output);
			if (!dateMatch) throw new Error(`Unable to parse date format. Invalid syntax in: "${output.substring(Math.max(0, output.search(DATE_REGEX_FORMATTED) - 10), Math.min(output.length, output.search(DATE_REGEX_FORMATTED) + 30))}..."`);

			const format = dateMatch[1];
			let offset: number | undefined;

			if (dateMatch[2]) {
				const offsetString = dateMatch[2].replace("+", "").trim();
				const offsetIsInt = NUMBER_REGEX.test(offsetString);
				if (offsetIsInt) offset = parseInt(offsetString);
			}

			output = this.replacer(
				output,
				DATE_REGEX_FORMATTED,
				getDate({ format, offset: offset }),
			);
		}

		return output;
	}

	protected replaceTimeInString(input: string): string {
		let output: string = input;

		while (TIME_REGEX.test(output)) {
			const timeMatch = TIME_REGEX.exec(output);
			if (!timeMatch) throw new Error(`Unable to parse time format. Invalid syntax in: "${output.substring(Math.max(0, output.search(TIME_REGEX) - 10), Math.min(output.length, output.search(TIME_REGEX) + 30))}..."`);

			output = this.replacer(output, TIME_REGEX, getDate({ format: "HH:mm" }));
		}

		while (TIME_REGEX_FORMATTED.test(output)) {
			const timeMatch = TIME_REGEX_FORMATTED.exec(output);
			if (!timeMatch) throw new Error(`Unable to parse formatted time. Invalid syntax in: "${output.substring(Math.max(0, output.search(TIME_REGEX_FORMATTED) - 10), Math.min(output.length, output.search(TIME_REGEX_FORMATTED) + 30))}..."`);

			const format = timeMatch[1];

			output = this.replacer(output, TIME_REGEX_FORMATTED, getDate({ format }));
		}

		return output;
	}

	protected abstract promptForValue(header?: string): Promise<string> | string;

	protected async replaceValueInString(input: string): Promise<string> {
		let output: string = input;

		if (this.variables.has("value")) {
			this.value = this.variables.get("value") as string;
		}

		while (NAME_VALUE_REGEX.test(output)) {
			if (!this.value) this.value = await this.promptForValue();

			output = this.replacer(output, NAME_VALUE_REGEX, this.value);
		}

		return output;
	}

	protected async replaceSelectedInString(input: string): Promise<string> {
		let output: string = input;

		const selectedText = await this.getSelectedText();

		while (SELECTED_REGEX.test(output)) {
			output = this.replacer(output, SELECTED_REGEX, selectedText);
		}

		return output;
	}

	protected async replaceClipboardInString(input: string): Promise<string> {
		let output: string = input;

		const clipboardContent = await this.getClipboardContent();

		while (CLIPBOARD_REGEX.test(output)) {
			output = this.replacer(output, CLIPBOARD_REGEX, clipboardContent);
		}

		return output;
	}

	 
	protected async replaceLinkToCurrentFileInString(
		input: string,
	): Promise<string> {
		const currentFilePathLink = this.getCurrentFileLink();
		let output = input;

		if (!currentFilePathLink && LINK_TO_CURRENT_FILE_REGEX.test(output)) {
			throw new Error("Unable to get current file path. Make sure you have a file open in the editor.");
		} else if (!currentFilePathLink) return output; // No need to throw, there's no {{LINKCURRENT}} + we can skip while loop.

		while (LINK_TO_CURRENT_FILE_REGEX.test(output))
			output = this.replacer(
				output,
				LINK_TO_CURRENT_FILE_REGEX,
				currentFilePathLink,
			);

		return output;
	}

	protected abstract getCurrentFileLink(): string | null;

	protected async replaceVariableInString(input: string) {
		let output: string = input;

		while (VARIABLE_REGEX.test(output)) {
			const match = VARIABLE_REGEX.exec(output);
			if (!match) throw new Error(`Unable to parse variable. Invalid syntax in: "${output.substring(Math.max(0, output.search(VARIABLE_REGEX) - 10), Math.min(output.length, output.search(VARIABLE_REGEX) + 30))}..."`);

			let variableName = match[1];
			let defaultValue = "";

			if (variableName) {
				// Parse default value if present (syntax: {{VALUE:name|default}})
				const pipeIndex = variableName.indexOf("|");
				if (pipeIndex !== -1) {
					defaultValue = variableName.substring(pipeIndex + 1).trim();
					variableName = variableName.substring(0, pipeIndex).trim();
				}

				if (!this.getVariableValue(variableName)) {
					const suggestedValues = variableName.split(",");
					let variableValue = "";

					if (suggestedValues.length === 1) {
						variableValue = await this.promptForVariable(variableName);
					} else {
						variableValue = await this.suggestForValue(suggestedValues);
					}

					// Use default value if no input provided
					if (!variableValue && defaultValue) {
						variableValue = defaultValue;
					}

					this.variables.set(variableName, variableValue);
				}

				output = this.replacer(
					output,
					VARIABLE_REGEX,
					this.getVariableValue(variableName),
				);
			} else {
				break;
			}
		}

		return output;
	}

	protected async replaceFieldVarInString(input: string) {
		let output: string = input;

		// Use the enhanced regex that supports filters
		while (FIELD_VAR_REGEX_WITH_FILTERS.test(output)) {
			const match = FIELD_VAR_REGEX_WITH_FILTERS.exec(output);
			if (!match) throw new Error(`Unable to parse field variable. Invalid syntax in: "${output.substring(Math.max(0, output.search(FIELD_VAR_REGEX_WITH_FILTERS) - 10), Math.min(output.length, output.search(FIELD_VAR_REGEX_WITH_FILTERS) + 30))}..."`);

			// match[1] contains the field name (and potentially the old filter syntax if no pipe is used)
			// match[2] contains the filter part starting with |, if present
			const fullMatch = match[1] + (match[2] || "");

			if (fullMatch) {
				if (!this.getVariableValue(fullMatch)) {
					this.variables.set(
						fullMatch,
						await this.suggestForField(fullMatch),
					);
				}

				output = this.replacer(
					output,
					FIELD_VAR_REGEX_WITH_FILTERS,
					this.getVariableValue(fullMatch),
				);
			} else {
				break;
			}
		}

		return output;
	}

	protected abstract promptForMathValue(): Promise<string>;

	protected async replaceMathValueInString(input: string) {
		let output: string = input;

		while (MATH_VALUE_REGEX.test(output)) {
			const mathstr = await this.promptForMathValue();
			output = this.replacer(output, MATH_VALUE_REGEX, mathstr);
		}

		return output;
	}

	protected async replaceMacrosInString(input: string): Promise<string> {
		let output: string = input;

		while (MACRO_REGEX.test(output)) {
			const exec = MACRO_REGEX.exec(output);
			if (!exec || !exec[1]) continue;

			const macroName = exec[1];
			const macroOutput = await this.getMacroValue(macroName);

			output = this.replacer(
				output,
				MACRO_REGEX,
				macroOutput ? macroOutput.toString() : "",
			);
		}

		return output;
	}

	protected abstract getVariableValue(variableName: string): string;

	protected abstract suggestForValue(
		suggestedValues: string[],
	): Promise<string> | string;

	protected abstract suggestForField(variableName: string): Promise<string>;

	protected async replaceDateVariableInString(input: string) {
		let output: string = input;

		while (DATE_VARIABLE_REGEX.test(output)) {
			const match = DATE_VARIABLE_REGEX.exec(output);
			if (!match || !match[1] || !match[2]) break;

			const variableName = match[1].trim();
			const dateFormat = match[2].trim();
			
			// Skip processing if variable name or format is empty
			// This prevents crashes when typing incomplete patterns like {{VDATE:,
			if (!variableName || !dateFormat) {
				break;
			}

			if (variableName && dateFormat) {
				const existingValue = this.variables.get(variableName) as string;
				
				// Check if we already have this date variable stored
				if (!existingValue) {
					// Prompt for date input with VDATE context
					const dateInput = await this.promptForVariable(
						variableName,
						{ type: "VDATE", dateFormat }
					);
					this.variables.set(variableName, dateInput);

					if (!this.dateParser) throw new Error("Date parser is not available");

					const parseAttempt = this.dateParser.parseDate(dateInput);

					if (parseAttempt) {
						// Store the ISO string with a special prefix
						this.variables.set(
							variableName,
							`@date:${parseAttempt.moment.toISOString()}`,
						);
					} else {
						throw new Error(
							`unable to parse date variable ${dateInput}`,
						);
					}
				}

				// Format the date based on what's stored
				let formattedDate = "";
				const storedValue = this.variables.get(variableName) as string;
				
				if (storedValue && storedValue.startsWith("@date:")) {
					// It's a date variable, extract and format it
					const isoString = storedValue.substring(6);
					 
					if (this.dateParser && window.moment) {
						const moment = window.moment(isoString);
						if (moment && moment.isValid()) {
							formattedDate = moment.format(dateFormat);
						}
					}
				} else if (storedValue) {
					// Backward compatibility: use the stored value as-is
					formattedDate = storedValue;
				}

				// Replace the specific match rather than using regex again
				// to handle multiple VDATE variables with same name but different formats
				output = output.replace(match[0], formattedDate);
			} else {
				break;
			}
		}

		return output;
	}

	protected async replaceTemplateInString(input: string): Promise<string> {
		let output: string = input;

		while (TEMPLATE_REGEX.test(output)) {
			const exec = TEMPLATE_REGEX.exec(output);
			if (!exec || !exec[1]) continue;

			const templatePath = exec[1];
			const templateContent = await this.getTemplateContent(templatePath);

			output = this.replacer(output, TEMPLATE_REGEX, templateContent);
		}

		return output;
	}

	protected replaceLinebreakInString(input: string): string {
		let output = "";

		for (let i = 0; i < input.length; i++) {
			const curr = input[i];
			const next = input[i + 1];

			if (curr == "\\") {
				if (next == "n") {
					output += "\n";
					i++;
				} else if (next == "\\") {
					output += "\\";
					i++;
				} else {
					// Invalid use of escape character, but we keep it anyway.
					output += '\\';
				}
			} else {
				output += curr;
			}
		}

		return output;
	}


	protected abstract getMacroValue(macroName: string): Promise<string> | string;

	protected abstract promptForVariable(
		variableName: string,
		context?: { type?: string; dateFormat?: string }
	): Promise<string>;

	protected abstract getTemplateContent(templatePath: string): Promise<string>;

	protected abstract getSelectedText(): Promise<string>;

	protected abstract getClipboardContent(): Promise<string>;
	
	protected replaceTitleInString(input: string): string {
		let output = input;
		const title = this.getVariableValue("title");
		
		while (TITLE_REGEX.test(output)) {
			output = this.replacer(output, TITLE_REGEX, title);
		}
		
		return output;
	}
}
