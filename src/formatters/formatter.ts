import {
    DATE_REGEX,
    DATE_REGEX_FORMATTED,
    DATE_VARIABLE_REGEX,
    LINK_TO_CURRENT_FILE_REGEX,
    MACRO_REGEX,
    NAME_VALUE_REGEX, TEMPLATE_REGEX,
    VARIABLE_REGEX
} from "../constants";
import {getDate} from "../utility";

export abstract class Formatter {
    protected value: string;
    protected variables: Map<string, string> = new Map<string, string>();

    protected abstract format(input: string): Promise<string>;

    protected replaceDateInString(input: string) {
        let output: string = input;

        while (DATE_REGEX.test(output)) {
            const dateMatch = DATE_REGEX.exec(output);
            let offset: string = dateMatch[1]
            if (offset)
                offset = offset.replace('+', '');

            output = output.replace(DATE_REGEX, getDate({offset: offset}));
        }

        while (DATE_REGEX_FORMATTED.test(output)) {
            const dateMatch = DATE_REGEX_FORMATTED.exec(output);
            const format = dateMatch[1].replace('+', '');
            const offset = parseInt(dateMatch[2]);

            output = output.replace(DATE_REGEX_FORMATTED, getDate({format, offset}));
        }

        return output;
    }

    protected abstract promptForValue(header?: string): Promise<string> | string;

    protected async replaceValueInString(input: string): Promise<string> {
        let output: string = input;

        while (NAME_VALUE_REGEX.test(output)) {
            if (!this.value)
                this.value = await this.promptForValue();

            output = output.replace(NAME_VALUE_REGEX, this.value);
        }

        return output;
    }

    protected async replaceLinkToCurrentFileInString(input) {
        const currentFilePath = await this.getCurrentFilePath();
        if (!currentFilePath) return input;

        const currentFilePathLink = `[[${currentFilePath}]]`;
        let output = input;

        while (LINK_TO_CURRENT_FILE_REGEX.test(output))
            output = output.replace(LINK_TO_CURRENT_FILE_REGEX, currentFilePathLink);

        return output;
    }

    protected abstract getCurrentFilePath();

    protected async replaceVariableInString(input: string) {
        let output: string = input;

        while (VARIABLE_REGEX.test(output)) {
            const match = VARIABLE_REGEX.exec(output);
            const variableName = match[1];

            if (variableName) {
                if (!this.getVariableValue(variableName)) {
                    const suggestedValues = variableName.split(",");

                    if (suggestedValues.length === 1)
                        this.variables.set(variableName, await this.promptForVariable(variableName));
                    else
                        this.variables.set(variableName, await this.suggestForValue(suggestedValues));
                }

                output = output.replace(VARIABLE_REGEX, this.getVariableValue(variableName));
            } else {
                break;
            }
        }

        return output;
    }
    protected async replaceMacrosInString(input: string): Promise<string> {
        let output: string = input;

        while(MACRO_REGEX.test(output)) {
            const macroName = MACRO_REGEX.exec(output)[1];
            const macroOutput = await this.getMacroValue(macroName);

            output = output.replace(MACRO_REGEX, macroOutput.toString());
        }

        return output;
    }

    protected abstract getVariableValue(variableName: string): string;

    protected abstract suggestForValue(suggestedValues: string[]);

    protected async replaceDateVariableInString(input: string) {
        let output: string = input;

        while (DATE_VARIABLE_REGEX.test(output)) {
            const match = DATE_VARIABLE_REGEX.exec(output);
            const variableName = match[1];
            const dateFormat = match[2];

            if (variableName && dateFormat) {
                if (!this.variables[variableName]) {
                    this.variables[variableName] = await this.promptForVariable(variableName);

                    const parseAttempt = this.getNaturalLanguageDates().parseDate(this.variables[variableName]);

                    if (parseAttempt)
                        this.variables[variableName] = parseAttempt.moment.format(dateFormat);
                    else
                        throw new Error(`unable to parse date variable ${this.variables[variableName]}`);
                }

                output = output.replace(DATE_VARIABLE_REGEX, this.variables[variableName]);
            } else {
                break;
            }
        }

    return output;
    }

    protected async replaceTemplateInString(input: string): Promise<string> {
        let output: string = input;

        while (TEMPLATE_REGEX.test(output)) {
            const templatePath = TEMPLATE_REGEX.exec(output)[1];
            const templateContent = await this.getTemplateContent(templatePath);

            output = output.replace(TEMPLATE_REGEX, templateContent);
        }

        return output;
    }

    protected abstract getNaturalLanguageDates();

    protected abstract getMacroValue(macroName: string): Promise<string> | string;

    protected abstract promptForVariable(variableName: string): Promise<string>;

    protected abstract getTemplateContent(templatePath: string): Promise<string>;
}