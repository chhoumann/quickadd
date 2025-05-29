/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
	DATE_REGEX,
	DATE_REGEX_FORMATTED,
	DATE_VARIABLE_REGEX,
	LINEBREAK_REGEX,
	LINK_TO_CURRENT_FILE_REGEX,
	MACRO_REGEX,
	MATH_VALUE_REGEX,
	NAME_VALUE_REGEX,
	NUMBER_REGEX,
	TEMPLATE_REGEX,
	VARIABLE_REGEX,
	FIELD_VAR_REGEX,
	SELECTED_REGEX,
	TIME_REGEX,
	TIME_REGEX_FORMATTED,
} from "../constants";
import { getDate } from "../utilityObsidian";

export abstract class Formatter {
	protected value: string;
	protected variables: Map<string, unknown> = new Map<string, string>();

	protected abstract format(input: string): Promise<string>;

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
			if (!dateMatch) throw new Error("unable to parse date");

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
			if (!timeMatch) throw new Error("unable to parse time");

			output = this.replacer(output, TIME_REGEX, getDate({ format: "HH:mm" }));
		}

		while (TIME_REGEX_FORMATTED.test(output)) {
			const timeMatch = TIME_REGEX_FORMATTED.exec(output);
			if (!timeMatch) throw new Error("unable to parse time");

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

	// eslint-disable-next-line @typescript-eslint/require-await
	protected async replaceLinkToCurrentFileInString(
		input: string,
	): Promise<string> {
		const currentFilePathLink = this.getCurrentFileLink();
		let output = input;

		if (!currentFilePathLink && LINK_TO_CURRENT_FILE_REGEX.test(output)) {
			throw new Error("unable to get current file path");
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
			if (!match) throw new Error("unable to parse variable");

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

		while (FIELD_VAR_REGEX.test(output)) {
			const match = FIELD_VAR_REGEX.exec(output);
			if (!match) throw new Error("unable to parse variable");

			const variableName = match[1];

			if (variableName) {
				if (!this.getVariableValue(variableName)) {
					this.variables.set(
						variableName,
						await this.suggestForField(variableName),
					);
				}

				output = this.replacer(
					output,
					FIELD_VAR_REGEX,
					this.getVariableValue(variableName),
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

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected abstract suggestForField(variableName: string): any;

	protected async replaceDateVariableInString(input: string) {
		let output: string = input;

		while (DATE_VARIABLE_REGEX.test(output)) {
			const match = DATE_VARIABLE_REGEX.exec(output);
			if (!match || !match[1] || !match[2]) continue;

			const variableName = match[1];
			const dateFormat = match[2];

			if (variableName && dateFormat) {
				if (!this.variables.get(variableName)) {
					this.variables.set(
						variableName,
						await this.promptForVariable(variableName),
					);

					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const nld = this.getNaturalLanguageDates();
					if (!nld || !nld.parseDate || typeof nld.parseDate !== "function")
						continue;

					const parseAttempt = (
						nld.parseDate as (s: string | undefined) => {
							moment: { format: (s: string) => string };
						}
					)(this.variables.get(variableName) as string);

					if (parseAttempt)
						this.variables.set(
							variableName,
							parseAttempt.moment.format(dateFormat),
						);
					else
						throw new Error(
							`unable to parse date variable ${this.variables.get(
								variableName,
							)}`,
						);
				}

				output = this.replacer(
					output,
					DATE_VARIABLE_REGEX,
					this.variables.get(variableName) as string, // literally setting it above / throwing error if not set
				);
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
		let output: string = input;
		let match = LINEBREAK_REGEX.exec(output);

		while (match && input[match.index - 1] !== "\\") {
			output = this.replacer(output, LINEBREAK_REGEX, `\n`);
			match = LINEBREAK_REGEX.exec(output);
		}

		const EscapedLinebreakRegex = /\\\\n/;
		while (EscapedLinebreakRegex.test(output)) {
			output = this.replacer(output, EscapedLinebreakRegex, `\\n`);
		}

		return output;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	protected abstract getNaturalLanguageDates(): any;

	protected abstract getMacroValue(macroName: string): Promise<string> | string;

	protected abstract promptForVariable(variableName: string): Promise<string>;

	protected abstract getTemplateContent(templatePath: string): Promise<string>;

	protected abstract getSelectedText(): Promise<string>;
}
