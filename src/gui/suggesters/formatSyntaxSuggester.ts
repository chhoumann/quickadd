import {TextInputSuggest} from "./suggest";
import type {App} from "obsidian";
import {
    DATE_FORMAT_SYNTAX_SUGGEST_REGEX,
    DATE_SYNTAX, DATE_SYNTAX_SUGGEST_REGEX,
    LINKCURRENT_SYNTAX,
    LINKCURRENT_SYNTAX_SUGGEST_REGEX, MACRO_SYNTAX_SUGGEST_REGEX, MATH_VALUE_SYNTAX,
    MATH_VALUE_SYNTAX_SUGGEST_REGEX,
    NAME_SYNTAX,
    NAME_SYNTAX_SUGGEST_REGEX,
    TEMPLATE_SYNTAX_SUGGEST_REGEX,
    VALUE_SYNTAX,
    VALUE_SYNTAX_SUGGEST_REGEX,
    VARIABLE_DATE_SYNTAX_SUGGEST_REGEX,
    VARIABLE_SYNTAX_SUGGEST_REGEX
} from "../../constants";
import {getTemplatePaths} from "../../utility";
import type QuickAdd from "../../main";

enum FormatSyntaxToken {
    Date, DateFormat, VariableDate, Value, Name,
    Variable, LinkCurrent, Macro, Template, MathValue
}

export class FormatSyntaxSuggester extends TextInputSuggest<string> {
    private lastInput: string = "";
    private lastInputType: FormatSyntaxToken;
    private readonly macroNames: string[];
    private readonly templatePaths: string[];

     constructor(public app: App, public inputEl: HTMLInputElement | HTMLTextAreaElement, private plugin: QuickAdd, private suggestForFileNames: boolean = false) {
        super(app, inputEl);

        this.macroNames = this.plugin.settings.macros.map(macro => macro.name);
        this.templatePaths = getTemplatePaths(this.app);

    }

    getSuggestions(inputStr: string): string[] {
        const cursorPosition: number = this.inputEl.selectionStart!;
        const lookbehind: number = 15;
        const inputBeforeCursor: string = inputStr.substr(cursorPosition - lookbehind, lookbehind);
        let suggestions: string[] = [];

        this.processToken(inputBeforeCursor, (match: RegExpMatchArray, type: FormatSyntaxToken, suggestion: string) => {
            this.lastInput = match[0];
            this.lastInputType = type;
            suggestions.push(suggestion);

            if (this.lastInputType === FormatSyntaxToken.Template) {
                suggestions.push(...this.templatePaths.map(templatePath => `{{TEMPLATE:${templatePath}}}`));
            }

            if (this.lastInputType === FormatSyntaxToken.Macro) {
                suggestions.push(...this.macroNames.map(macroName => `{{MACRO:${macroName}}}`));
            }
        })

        return suggestions;
    }

    selectSuggestion(item: string): void {
        const cursorPosition: number = this.inputEl.selectionStart!;
        const lastInputLength: number = this.lastInput.length;
        const currentInputValue: string = this.inputEl.value;
        let insertedEndPosition: number = 0;

        const insert = (text: string, offset: number = 0) => {
            return `${currentInputValue.substr(0, cursorPosition - lastInputLength + offset)}${text}${currentInputValue.substr(cursorPosition)}`;
        }

        this.processToken(item, ((match, type, suggestion) => {
            if (item.contains(suggestion)) {
                this.inputEl.value = insert(item);
                this.lastInputType = type;
                insertedEndPosition = cursorPosition - lastInputLength + item.length;

                if (this.lastInputType === FormatSyntaxToken.VariableDate ||
                    this.lastInputType === FormatSyntaxToken.Variable ||
                    this.lastInputType === FormatSyntaxToken.DateFormat)
                {
                    insertedEndPosition -= 2;
                }
            }
        }));

        this.inputEl.trigger("input");
        this.close();
        this.inputEl.setSelectionRange(insertedEndPosition, insertedEndPosition);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        if (value) el.setText(value);
    }


    private processToken(input: string,
                         callback: ((match: RegExpMatchArray, type: FormatSyntaxToken, suggestion: string) => void))
    {
        const dateFormatMatch = DATE_FORMAT_SYNTAX_SUGGEST_REGEX.exec(input);
        if (dateFormatMatch) callback(dateFormatMatch, FormatSyntaxToken.DateFormat, "{{DATE:}}");

        const dateMatch = DATE_SYNTAX_SUGGEST_REGEX.exec(input);
        if (dateMatch) callback(dateMatch, FormatSyntaxToken.Date, DATE_SYNTAX);

        const nameMatch = NAME_SYNTAX_SUGGEST_REGEX.exec(input);
        if (nameMatch) callback(nameMatch, FormatSyntaxToken.Name, NAME_SYNTAX);

        const valueMatch = VALUE_SYNTAX_SUGGEST_REGEX.exec(input);
        if (valueMatch) callback(valueMatch, FormatSyntaxToken.Value, VALUE_SYNTAX);

        const mathValueMatch = MATH_VALUE_SYNTAX_SUGGEST_REGEX.exec(input);
        if (mathValueMatch) callback(mathValueMatch, FormatSyntaxToken.MathValue, MATH_VALUE_SYNTAX);

        const variableMatch = VARIABLE_SYNTAX_SUGGEST_REGEX.exec(input);
        if (variableMatch) callback(variableMatch, FormatSyntaxToken.Variable, "{{VALUE:}}");

        const variableDateMatch = VARIABLE_DATE_SYNTAX_SUGGEST_REGEX.exec(input);
        if (variableDateMatch) callback(variableDateMatch, FormatSyntaxToken.VariableDate, "{{VDATE:}}")

        if (!this.suggestForFileNames) {
            const linkCurrentMatch = LINKCURRENT_SYNTAX_SUGGEST_REGEX.exec(input);
            if (linkCurrentMatch) callback(linkCurrentMatch, FormatSyntaxToken.LinkCurrent, LINKCURRENT_SYNTAX);

            const templateMatch = TEMPLATE_SYNTAX_SUGGEST_REGEX.exec(input);
            if (templateMatch) callback(templateMatch, FormatSyntaxToken.Template, "{{TEMPLATE:");

            const macroMatch = MACRO_SYNTAX_SUGGEST_REGEX.exec(input);
            if (macroMatch) callback(macroMatch, FormatSyntaxToken.Macro, "{{MACRO:");
        }
    }
}