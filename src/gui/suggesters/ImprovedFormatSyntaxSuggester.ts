import { TextInputSuggest } from "./BaseSuggest";
import type { App } from "obsidian";
import {
	DATE_FORMAT_SYNTAX_SUGGEST_REGEX,
	DATE_SYNTAX,
	DATE_SYNTAX_SUGGEST_REGEX,
	TIME_SYNTAX,
	LINKCURRENT_SYNTAX,
	LINKCURRENT_SYNTAX_SUGGEST_REGEX,
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
	TIME_SYNTAX_SUGGEST_REGEX,
} from "../../constants";
import type QuickAdd from "../../main";
import { replaceRange, getTextBeforeCursor } from "./utils";

enum FormatSyntaxToken {
	Date,
	DateFormat,
	VariableDate,
	Value,
	Name,
	Variable,
	LinkCurrent,
	Macro,
	Template,
	MathValue,
	Time,
	Selected
}

interface TokenDefinition {
	regex: RegExp;
	token: FormatSyntaxToken;
	suggestion: string;
	cursorOffset?: number; // How far back to position cursor from end
}

export class ImprovedFormatSyntaxSuggester extends TextInputSuggest<string> {
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

		this.macroNames = this.plugin.settings.macros.map(
			(macro) => macro.name
		);
		
		this.templatePaths = this.plugin.getTemplateFiles().map((file) => file.path);
	}

	async getSuggestions(inputStr: string): Promise<string[]> {
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

		const suggestions: string[] = [];

		// Check all token definitions
		const allTokens = [
			...this.tokenDefinitions,
			...(this.suggestForFileNames ? [] : this.contextualTokens)
		];

		for (const tokenDef of allTokens) {
			const match = tokenDef.regex.exec(inputSegment);
			if (!match) continue;

			// If only "{{" has been typed (length 2), skip suggestions – user hasn't started a token yet
			if (match[0].length <= 2) {
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
		replaceRange(this.inputEl, replaceStart, replaceEnd, item);

		// Position cursor for tokens that need input
		const tokenDef = this.getTokenDefinition(this.lastInputType);
		if (tokenDef?.cursorOffset) {
			const newCursorPos = replaceStart + item.length - tokenDef.cursorOffset;
			this.inputEl.setSelectionRange(newCursorPos, newCursorPos);
		}

		this.close();
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		if (!value) return;
		// Highlight using the current query fragment for accuracy
		const highlighted = this.renderMatch(value, this.getCurrentQuery());
		el.innerHTML = highlighted;
	}

	private getTokenDefinition(token: FormatSyntaxToken): TokenDefinition | undefined {
		return [...this.tokenDefinitions, ...this.contextualTokens]
			.find(def => def.token === token);
	}
}

// Maintain backward compatibility
export class FormatSyntaxSuggester extends ImprovedFormatSyntaxSuggester {}
