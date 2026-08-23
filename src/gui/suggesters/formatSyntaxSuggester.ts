import { TextInputSuggest } from "./suggest";
import type { App } from "obsidian";
import type QuickAdd from "../../main";
import { replaceRange } from "./utils";
import { flattenChoices } from "../../utils/choiceUtils";
import type {
	FormatSuggestContext,
	FormatTokenSuggestion,
} from "./formatTokenRegistry";
import {
	CASE_STYLE_SUGGESTIONS,
	EXPANSION_MIN_PREFIX,
	entriesForContext,
} from "./formatTokenRegistry";

export type { FormatSuggestContext } from "./formatTokenRegistry";

const CASE_FRAGMENT_REGEX =
	/^\{\{(VALUE|NAME|DATE|TIME|VDATE)([^\n\r}]*)\|case:([a-z-]*)$/i;
const DATE_TOKEN_TYPES = new Set(["DATE", "TIME", "VDATE"]);
/** The `<folder>`-style fill-in-the-blank inside an example row. */
const PLACEHOLDER_REGEX = /<[^<>\n\r]+>/;

export class FormatSyntaxSuggester extends TextInputSuggest<FormatTokenSuggestion> {
	/** Start offset of the fragment the accepted suggestion replaces. */
	private replaceFrom = 0;
	/** The letters typed after "{{", used to highlight what matched. */
	private matchedQuery = "";
	private readonly macroNames: string[];
	private readonly templatePaths: string[];

	constructor(
		public app: App,
		public inputEl: HTMLInputElement | HTMLTextAreaElement,
		private plugin: QuickAdd,
		private context: FormatSuggestContext = "noteContent",
	) {
		super(app, inputEl);

		this.macroNames = flattenChoices(this.plugin.settings.choices)
			.filter((choice) => choice.type === "Macro")
			.map((choice) => choice.name);

		this.templatePaths = this.plugin.getTemplateFiles().map((file) => file.path);
	}

	getSuggestions(inputStr: string): FormatTokenSuggestion[] {
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

		// Suggest casing styles inside every token family that supports |case:.
		const caseMatch = inputSegment.match(CASE_FRAGMENT_REGEX);
		if (caseMatch) {
			const tokenType = caseMatch[1]?.toUpperCase() ?? "";
			const tokenBody = caseMatch[2] ?? "";
			if (
				DATE_TOKEN_TYPES.has(tokenType) &&
				tokenBody.lastIndexOf("[") > tokenBody.lastIndexOf("]")
			) {
				return [];
			}

			const fragment = caseMatch[3] ?? "";
			this.matchedQuery = fragment;
			this.replaceFrom = cursorPosition - fragment.length;

			const normalizedFragment = fragment.toLowerCase();
			return CASE_STYLE_SUGGESTIONS.filter((style) =>
				style.insert.startsWith(normalizedFragment),
			).map((style) => ({ ...style }));
		}

		// If the segment already contains a colon we consider the token "open" for user parameters → no more format suggestions.
		if (inputSegment.includes(":")) {
			return [];
		}

		const suggestions: FormatTokenSuggestion[] = [];
		const seen = new Set<string>();
		const add = (suggestion: FormatTokenSuggestion) => {
			if (seen.has(suggestion.insert)) return;
			seen.add(suggestion.insert);
			suggestions.push(suggestion);
		};

		// Every token matcher is anchored on the leading "{{", and a match is only
		// accepted when it runs to the cursor, so an accepted match is always the
		// whole segment: the replaced span and the matched letters are the same
		// for every row and can be settled once.
		this.replaceFrom = startBrace;
		// Highlight only the letters typed after "{{": at a bare "{{" the braces
		// are on every row, and marking them just adds noise.
		this.matchedQuery = inputSegment.slice(2);

		const matched = entriesForContext(this.context).filter((entry) => {
			const match = entry.regex.exec(inputSegment);
			// Only accept matches that run right up to the cursor (i.e., the user is still typing this token)
			return (
				match !== null &&
				match.index + match[0].length === inputSegment.length
			);
		});

		// Tokens the typed letters actually start come first. The matchers admit
		// interior matches too ("{{dat" reaches {{VDATE:}} because its optional
		// letter classes skip the V), and those should never outrank the token the
		// user is most likely spelling. The partition is stable, so the curated
		// registry order survives within each half; at a bare "{{" the query is
		// empty, every row prefix-matches, and the whole list keeps its order.
		const query = this.matchedQuery.toLowerCase();
		const startsWithQuery = (entry: (typeof matched)[number]) =>
			entry.suggestion.insert.slice(2).toLowerCase().startsWith(query);
		const ranked = [
			...matched.filter(startsWithQuery),
			...matched.filter((entry) => !startsWithQuery(entry)),
		];

		for (const entry of ranked) {
			add(entry.suggestion);

			// Worked examples arrive once the user has named the token they want,
			// so the bare "{{" list stays an index of what exists.
			if (!entry.expansions) continue;
			if (this.matchedQuery.length < EXPANSION_MIN_PREFIX) continue;
			for (const expansion of entry.expansions({
				templatePaths: this.templatePaths,
				macroNames: this.macroNames,
				globalVariableNames: Object.keys(
					this.plugin?.settings?.globalVariables ?? {},
				),
				context: this.context,
				formatDate: (momentFormat) =>
					typeof window.moment === "function"
						? window.moment().format(momentFormat)
						: momentFormat,
			})) {
				add(expansion);
			}
		}

		return suggestions;
	}

	selectSuggestion(item: FormatTokenSuggestion): void {
		if (this.inputEl.selectionStart === null) return;

		const cursorPosition: number = this.inputEl.selectionStart;
		const replaceStart = this.replaceFrom;

		// Replace the partial syntax with the complete syntax
		replaceRange(this.inputEl, replaceStart, cursorPosition, item.insert, {
			fromCompletion: true,
		});

		// A row like {{FILE:<folder>}} is a shape to fill in, not a finished token.
		// Selecting the first <placeholder> means the next keystroke replaces it,
		// instead of leaving the literal angle brackets in the format.
		const placeholder = PLACEHOLDER_REGEX.exec(item.insert);
		if (placeholder) {
			const start = replaceStart + placeholder.index;
			this.inputEl.setSelectionRange(start, start + placeholder[0].length);
		} else if (item.caretOffset > 0) {
			const newCursorPos = replaceStart + item.insert.length - item.caretOffset;
			this.inputEl.setSelectionRange(newCursorPos, newCursorPos);
		}

		this.close();
	}

	renderSuggestion(value: FormatTokenSuggestion, el: HTMLElement): void {
		if (!value) return;
		el.classList.add("qa-format-suggestion");

		const tokenEl = el.ownerDocument.createElement("span");
		tokenEl.className = value.isFragment
			? "qa-format-suggestion-token qa-format-suggestion-token-fragment"
			: "qa-format-suggestion-token";
		this.renderMatch(tokenEl, value.insert, this.matchedQuery);
		el.appendChild(tokenEl);

		const descriptionEl = el.ownerDocument.createElement("span");
		descriptionEl.className = "qa-format-suggestion-description";
		descriptionEl.textContent = value.description;
		el.appendChild(descriptionEl);
	}
}
