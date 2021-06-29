import {TextInputSuggest} from "./suggest";
import type {App} from "obsidian";
import type QuickAdd from "../main";
import {
    DATE_FORMAT_SYNTAX_SUGGEST_REGEX, DATE_SYNTAX,
    DATE_SYNTAX_SUGGEST_REGEX, LINKCURRENT_SYNTAX,
    LINKCURRENT_SYNTAX_SUGGEST_REGEX,
    MACRO_SYNTAX_SUGGEST_REGEX, NAME_SYNTAX,
    NAME_SYNTAX_SUGGEST_REGEX,
    TEMPLATE_SYNTAX_SUGGEST_REGEX, VALUE_SYNTAX,
    VALUE_SYNTAX_SUGGEST_REGEX,
    VARIABLE_DATE_SYNTAX_SUGGEST_REGEX, VARIABLE_SYNTAX,
    VARIABLE_SYNTAX_SUGGEST_REGEX
} from "../constants";
import {getTemplatePaths} from "../utility";

enum FormatSyntaxToken {
    Date, DateFormat, VariableDate, Value, Name,
    Variable, LinkCurrent, Macro, Template
}

export class FormatSyntaxSuggester extends TextInputSuggest<string> {
    private lastInput: string = "";
    private lastInputType: FormatSyntaxToken;
    private readonly macroNames: string[];
    private readonly templatePaths: string[];

     constructor(public app: App, public inputEl: HTMLInputElement | HTMLTextAreaElement, private plugin: QuickAdd) {
        super(app, inputEl);

        this.macroNames = this.plugin.settings.macros.map(macro => macro.name);
        this.templatePaths = getTemplatePaths(this.app);

    }

    getSuggestions(inputStr: string): string[] {
        const cursorPosition: number = this.inputEl.selectionStart;
        const inputBeforeCursor: string = inputStr.substr(0, cursorPosition);

        return this.parseInputAndGetSuggestions(inputBeforeCursor);
    }

    selectSuggestion(item: string): void {
        const cursorPosition: number = this.inputEl.selectionStart;
        const lastInputLength: number = this.lastInput.length;
        const currentInputValue: string = this.inputEl.value;
        let insertedEndPosition: number = 0;

        const insert = (text: string, offset: number = 0) => {
            return `${currentInputValue.substr(0, cursorPosition - lastInputLength + offset)}${text}${currentInputValue.substr(cursorPosition)}`;
        }
        console.log(this.lastInputType);
        console.log(cursorPosition)
        console.log(lastInputLength)

        if (this.lastInputType === FormatSyntaxToken.Date) {
            this.inputEl.value = insert(DATE_SYNTAX);
            insertedEndPosition = cursorPosition - lastInputLength + item.length + 2;
        }

        this.inputEl.trigger("input");
        this.close();
        this.inputEl.setSelectionRange(insertedEndPosition, insertedEndPosition);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        if (value) el.setText(value);
    }


    private parseInputAndGetSuggestions(inputBeforeCursor: string) {
        let suggestions: string[] = [];

        const processMatch = (match: RegExpMatchArray, type: FormatSyntaxToken, suggestion: string) => {
            console.log(match);
            this.lastInput = match[0];
            this.lastInputType = type;
            suggestions.push(suggestion);
        }

        const dateFormatMatch = DATE_FORMAT_SYNTAX_SUGGEST_REGEX.exec(inputBeforeCursor);
        if (dateFormatMatch) processMatch(dateFormatMatch, FormatSyntaxToken.DateFormat, "{{DATE:");

        const dateMatch = DATE_SYNTAX_SUGGEST_REGEX.exec(inputBeforeCursor);
        if (dateMatch) processMatch(dateMatch, FormatSyntaxToken.Date, DATE_SYNTAX);

        const nameMatch = NAME_SYNTAX_SUGGEST_REGEX.exec(inputBeforeCursor);
        if (nameMatch) processMatch(nameMatch, FormatSyntaxToken.Name, NAME_SYNTAX);

        const valueMatch = VALUE_SYNTAX_SUGGEST_REGEX.exec(inputBeforeCursor);
        if (valueMatch) processMatch(valueMatch, FormatSyntaxToken.Value, VALUE_SYNTAX);

        const variableMatch = VARIABLE_SYNTAX_SUGGEST_REGEX.exec(inputBeforeCursor);
        if (variableMatch) processMatch(variableMatch, FormatSyntaxToken.Variable, "{{VALUE:");

        const variableDateMatch = VARIABLE_DATE_SYNTAX_SUGGEST_REGEX.exec(inputBeforeCursor);
        if (variableDateMatch) processMatch(variableDateMatch, FormatSyntaxToken.VariableDate, "{{VDATE:")

        const linkCurrentMatch = LINKCURRENT_SYNTAX_SUGGEST_REGEX.exec(inputBeforeCursor);
        if (linkCurrentMatch) processMatch(linkCurrentMatch, FormatSyntaxToken.LinkCurrent, LINKCURRENT_SYNTAX);

        const templateMatch = TEMPLATE_SYNTAX_SUGGEST_REGEX.exec(inputBeforeCursor);
        if (templateMatch) processMatch(templateMatch, FormatSyntaxToken.Template, "{{TEMPLATE:");

        const macroMatch = MACRO_SYNTAX_SUGGEST_REGEX.exec(inputBeforeCursor);
        if (macroMatch) processMatch(macroMatch, FormatSyntaxToken.Macro, "{{MACRO:");

        return suggestions;
    }
}