import {
    DATE_REGEX, DATE_REGEX_FORMATTED,
    DATE_VARIABLE_REGEX,
    LINK_TO_CURRENT_FILE_REGEX,
    NAME_VALUE_REGEX,
    VARIABLE_REGEX
} from "../constants";
import {getDate} from "../utility";

export abstract class Formatter {
    protected value: string;
    private variables: Map<string, string> = new Map<string, string>();

    public abstract format(input: string): Promise<string>;

    protected replaceDateInString(input: string) {
        let output: string = input;

        while (DATE_REGEX.test(output)) {
            const dateMatch = DATE_REGEX.exec(output);
            const offset: string = dateMatch[1].replace('+', '');

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

    protected abstract promptForValue(header?: string): string;

    protected async replaceValueInString(input: string): Promise<string> {
        this.value = await this.promptForValue();
        let output: string = input;

        while (NAME_VALUE_REGEX.test(output)) {
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
                        this.variables[variableName] = await this.promptForValue(variableName);
                    else
                        this.variables[variableName] = await this.suggestForValue(suggestedValues);
                }

                output = output.replace(VARIABLE_REGEX, this.getVariableValue(variableName));
            } else {
                break;
            }
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
                    this.variables[variableName] = await this.promptForValue(variableName);

                    const parseAttempt = this.getNaturalLanguageDates().parseDate(this.variables[variableName]);

                    if (parseAttempt)
                        this.variables[variableName] = window.moment().format(dateFormat);
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

    protected abstract getNaturalLanguageDates();

}