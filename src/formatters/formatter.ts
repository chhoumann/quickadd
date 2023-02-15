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
} from "../constants";
import { getDate } from "../utility";

export abstract class Formatter {
	protected value: string;
	protected variables: Map<string, string> = new Map<string, string>();

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
			let offset: number;

			if (dateMatch && dateMatch[1]) {
				const offsetString = dateMatch[1].replace("+", "").trim();
				const offsetIsInt = NUMBER_REGEX.test(offsetString);
				if (offsetIsInt) offset = parseInt(offsetString);
			}
			output = this.replacer(
				output,
				DATE_REGEX,
				getDate({ offset: offset! })
			);
		}

		while (DATE_REGEX_FORMATTED.test(output)) {
			const dateMatch = DATE_REGEX_FORMATTED.exec(output);
			if (!dateMatch) throw new Error("unable to parse date");

			const format = dateMatch[1];
			let offset: number;

			if (dateMatch[2]) {
				const offsetString = dateMatch[2].replace("+", "").trim();
				const offsetIsInt = NUMBER_REGEX.test(offsetString);
				if (offsetIsInt) offset = parseInt(offsetString);
			}

			output = this.replacer(
				output,
				DATE_REGEX_FORMATTED,
				getDate({ format, offset: offset! })
			);
		}

		return output;
	}

	protected abstract promptForValue(
		header?: string
	): Promise<string> | string;

	protected async replaceValueInString(input: string): Promise<string> {
		let output: string = input;

		while (NAME_VALUE_REGEX.test(output)) {
			if (!this.value) this.value = await this.promptForValue();

			output = this.replacer(output, NAME_VALUE_REGEX, this.value);
		}

		return output;
	}

	protected async replaceLinkToCurrentFileInString(
		input: string
	): Promise<string> {
		const currentFilePathLink = this.getCurrentFileLink();
		let output = input;

		while (LINK_TO_CURRENT_FILE_REGEX.test(output))
			output = this.replacer(
				output,
				LINK_TO_CURRENT_FILE_REGEX,
				currentFilePathLink
			);

		return output;
	}

	protected abstract getCurrentFileLink(): any;

	protected async replaceVariableInString(input: string) {
		let output: string = input;

		while (VARIABLE_REGEX.test(output)) {
			const match = VARIABLE_REGEX.exec(output);
			if (!match) throw new Error("unable to parse variable");

			const variableName = match[1];

			if (variableName) {
				if (!this.getVariableValue(variableName)) {
					const suggestedValues = variableName.split(",");

					if (suggestedValues.length === 1)
						this.variables.set(
							variableName,
							await this.promptForVariable(variableName)
						);
					else
						this.variables.set(
							variableName,
							await this.suggestForValue(suggestedValues)
						);
				}

				output = this.replacer(
					output,
					VARIABLE_REGEX,
					this.getVariableValue(variableName)
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
			const macroName = MACRO_REGEX.exec(output)![1];
			const macroOutput = await this.getMacroValue(macroName);

			output = this.replacer(
				output,
				MACRO_REGEX,
				macroOutput ? macroOutput.toString() : ""
			);
		}

		return output;
	}

	protected abstract getVariableValue(variableName: string): string;

	protected abstract suggestForValue(suggestedValues: string[]): any;

	protected async replaceDateVariableInString(input: string) {
		let output: string = input;

		while (DATE_VARIABLE_REGEX.test(output)) {
			const match = DATE_VARIABLE_REGEX.exec(output);
			const variableName = match![1];
			const dateFormat = match![2];

			if (variableName && dateFormat) {
				if (!this.variables.get(variableName)) {
					this.variables.set(
						variableName,
						await this.promptForVariable(variableName)
					);

					const parseAttempt =
						this.getNaturalLanguageDates().parseDate(
							this.variables.get(variableName)
						);

					if (parseAttempt)
						this.variables.set(
							variableName,
							parseAttempt.moment.format(dateFormat)
						);
					else
						throw new Error(
							`unable to parse date variable ${this.variables.get(
								variableName
							)}`
						);
				}

				output = this.replacer(
					output,
					DATE_VARIABLE_REGEX,
					this.variables.get(variableName)!
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
			const templatePath = TEMPLATE_REGEX.exec(output)![1];
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

	protected abstract getNaturalLanguageDates(): any;

	protected abstract getMacroValue(
		macroName: string
	): Promise<string> | string;

	protected abstract promptForVariable(variableName: string): Promise<string>;

	protected abstract getTemplateContent(
		templatePath: string
	): Promise<string>;

	protected abstract getSelectedText(): Promise<string>;
}
