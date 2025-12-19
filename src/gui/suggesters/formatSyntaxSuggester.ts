import { TextInputSuggest } from "./suggest";
import type { App } from "obsidian";
import {
	DATE_FORMAT_SYNTAX_SUGGEST_REGEX,
	DATE_SYNTAX,
	DATE_SYNTAX_SUGGEST_REGEX,
	TIME_SYNTAX,
	LINKCURRENT_SYNTAX,
	LINKCURRENT_SYNTAX_SUGGEST_REGEX,
	FILENAMECURRENT_SYNTAX,
	FILENAMECURRENT_SYNTAX_SUGGEST_REGEX,
	MACRO_SYNTAX_SUGGEST_REGEX,
	MATH_VALUE_SYNTAX,
	MATH_VALUE_SYNTAX_SUGGEST_REGEX,
	NAME_SYNTAX,
	NAME_SYNTAX_SUGGEST_REGEX,
	TEMPLATE_SYNTAX_SUGGEST_REGEX,
	VALUE_SYNTAX,
	VALUE_SYNTAX_SUGGEST_REGEX,
	VARIABLE_DATE_SYNTAX_SUGGEST_REGEX,
	VARIABLE_SYNTAX_SUGGEST_REGEX,
	SELECTED_SYNTAX_SUGGEST_REGEX,
	SELECTED_SYNTAX,
	CLIPBOARD_SYNTAX_SUGGEST_REGEX,
	CLIPBOARD_SYNTAX,
	TIME_SYNTAX_SUGGEST_REGEX,
	TITLE_SYNTAX_SUGGEST_REGEX,
	TITLE_SYNTAX,
	RANDOM_SYNTAX_SUGGEST_REGEX,
	GLOBAL_VAR_SYNTAX_SUGGEST_REGEX,
} from "../../constants";
import type QuickAdd from "../../main";
import { replaceRange } from "./utils";
import { flattenChoices } from "../../utils/choiceUtils";

enum FormatSyntaxToken {
	Date,
	DateFormat,
	VariableDate,
	Value,
	Name,
	Variable,
	LinkCurrent,
	FilenameCurrent,
	Macro,
	Template,
	MathValue,
	Time,
	Selected,
	Clipboard,
	Random,
	Title,
	GlobalVar,
}

interface TokenDefinition {
	regex: RegExp;
	token: FormatSyntaxToken;
	suggestion: string;
	cursorOffset?: number; // How far back to position cursor from end
}

export class FormatSyntaxSuggester extends TextInputSuggest<string> {
	private lastInput = "";
	private lastInputType: FormatSyntaxToken;
	private lastInputStart = 0;
	private readonly macroNames: string[];
	private readonly templatePaths: string[];

	// Table-driven approach for cleaner token processing
	private readonly tokenDefinitions: TokenDefinition[] = [
		{
			regex: DATE_FORMAT_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.DateFormat,
			suggestion: "{{DATE:}}",
			cursorOffset: 2
		},
		{
			regex: DATE_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.Date,
			suggestion: DATE_SYNTAX
		},
		{
			regex: TIME_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.Time,
			suggestion: TIME_SYNTAX
		},
		{
			regex: NAME_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.Name,
			suggestion: NAME_SYNTAX
		},
		{
			regex: VALUE_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.Value,
			suggestion: VALUE_SYNTAX
		},
		{
			regex: MATH_VALUE_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.MathValue,
			suggestion: MATH_VALUE_SYNTAX
		},
		{
			regex: SELECTED_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.Selected,
			suggestion: SELECTED_SYNTAX
		},
		{
			regex: CLIPBOARD_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.Clipboard,
			suggestion: CLIPBOARD_SYNTAX
		},
		{
			regex: RANDOM_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.Random,
			suggestion: "{{RANDOM:}}",
			cursorOffset: 2
		},
		{
			regex: GLOBAL_VAR_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.GlobalVar,
			suggestion: "{{GLOBAL_VAR:}}",
			cursorOffset: 2,
		},
		{
			regex: VARIABLE_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.Variable,
			suggestion: "{{VALUE:}}",
			cursorOffset: 2
		},
		{
			regex: VARIABLE_DATE_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.VariableDate,
			suggestion: "{{VDATE:}}",
			cursorOffset: 2
		},
	];

	private readonly contextualTokens: TokenDefinition[] = [
		{
			regex: LINKCURRENT_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.LinkCurrent,
			suggestion: LINKCURRENT_SYNTAX
		},
		{
			regex: FILENAMECURRENT_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.FilenameCurrent,
			suggestion: FILENAMECURRENT_SYNTAX
		},
		{
			regex: TITLE_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.Title,
			suggestion: TITLE_SYNTAX
		},
		{
			regex: TEMPLATE_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.Template,
			suggestion: "{{TEMPLATE:"
		},
		{
			regex: MACRO_SYNTAX_SUGGEST_REGEX,
			token: FormatSyntaxToken.Macro,
			suggestion: "{{MACRO:"
		},
	];

	constructor(
		public app: App,
		public inputEl: HTMLInputElement | HTMLTextAreaElement,
		private plugin: QuickAdd,
		private suggestForFileNames: boolean = false
	) {
		super(app, inputEl);

		// Get macro names from choices
		this.macroNames = flattenChoices(this.plugin.settings.choices)
			.filter((choice) => choice.type === "Macro")
			.map((choice) => choice.name);
		
		this.templatePaths = this.plugin.getTemplateFiles().map((file) => file.path);
	}

	async getSuggestions(inputStr: string): Promise<string[]> {
		if (this.inputEl.selectionStart === null) return [];
		const cursorPosition: number = this.inputEl.selectionStart;

		// Find the last opening braces "{{" before the cursor – we only care about the fragment
		// the user is currently typing, not earlier, already-completed tokens.
		const startBrace = inputStr.lastIndexOf("{{", cursorPosition - 1);
		if (startBrace === -1) return [];

		const inputSegment = inputStr.slice(startBrace, cursorPosition);

		// If the user has already typed the closing braces in this segment, nothing to suggest.
		if (inputSegment.includes("}}")) {
			return [];
		}

		// If the segment already contains a colon we consider the token "open" for user parameters → no more format suggestions
		if (inputSegment.includes(":")) {
			return [];
		}

		const suggestions: string[] = [];

		// Check all token definitions
		const allTokens = [
			...this.tokenDefinitions,
			...(this.suggestForFileNames ? [] : this.contextualTokens)
		];

		for (const tokenDef of allTokens) {
			const match = tokenDef.regex.exec(inputSegment);
			if (!match) continue;

			// Only accept matches that run right up to the cursor (i.e., the user is still typing this token)
			if (match.index + match[0].length !== inputSegment.length) {
				continue;
			}

			this.lastInput = match[0];
			this.lastInputType = tokenDef.token;
			this.lastInputStart = cursorPosition - match[0].length;

			// Avoid duplicates
			if (!suggestions.includes(tokenDef.suggestion)) {
				suggestions.push(tokenDef.suggestion);
			}

			// Add dynamic suggestions for template and macro
			if (tokenDef.token === FormatSyntaxToken.Template) {
				suggestions.push(
					...this.templatePaths.map(
						(templatePath) => `{{TEMPLATE:${templatePath}}}`
					)
				);
			} else if (tokenDef.token === FormatSyntaxToken.Macro) {
				suggestions.push(
					...this.macroNames.map(
						(macroName) => `{{MACRO:${macroName}}}`
					)
				);
				suggestions.push("{{MACRO:MyMacro|Label}}");
			} else if (tokenDef.token === FormatSyntaxToken.VariableDate) {
				// Add example suggestions for VDATE with and without default values
				suggestions.push(
					"{{VDATE:date,YYYY-MM-DD}}",
					"{{VDATE:date,YYYY-MM-DD|today}}",
					"{{VDATE:dueDate,YYYY-MM-DD|next monday}}"
				);
			} else if (tokenDef.token === FormatSyntaxToken.GlobalVar) {
				// Suggest defined global variable names
				const globals = Object.keys(this.plugin?.settings?.globalVariables ?? {});
				suggestions.push(
					...globals.map((name) => `{{GLOBAL_VAR:${name}}}`)
				);
			} else if (tokenDef.token === FormatSyntaxToken.Variable) {
				// Add example suggestions for VALUE with and without custom modifier
				suggestions.push(
					"{{VALUE:option1,option2,option3}}",
					"{{VALUE:option1,option2,option3|custom}}",
					"{{VALUE:title|label:Helper text}}",
					"{{VALUE:option1,option2|label:Pick one}}",
					"{{VALUE:title|label:Snake case|default:My_Title}}"
				);
			}
		}

		return suggestions;
	}

	selectSuggestion(item: string): void {
		if (this.inputEl.selectionStart === null) return;
		
		const cursorPosition: number = this.inputEl.selectionStart;
		const replaceStart = this.lastInputStart;
		const replaceEnd = cursorPosition;

		// Replace the partial syntax with the complete syntax
		replaceRange(this.inputEl, replaceStart, replaceEnd, item, { fromCompletion: true });

		// Determine cursor offset dynamically based on the chosen item
		const offset = item.includes(":") ? 2 : 0; // place before "}}" if there is a colon
		if (offset) {
			const newCursorPos = replaceStart + item.length - offset;
			this.inputEl.setSelectionRange(newCursorPos, newCursorPos);
		}

		this.close();
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		if (!value) return;
		// Highlight using the current query fragment for accuracy
		this.renderMatch(el, value, this.getCurrentQuery());
	}

	private getTokenDefinition(token: FormatSyntaxToken): TokenDefinition | undefined {
		return [...this.tokenDefinitions, ...this.contextualTokens]
			.find(def => def.token === token);
	}
}
