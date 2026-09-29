import type { App, SearchMatches } from "obsidian";
import { rankMatches } from "./rankMatches";
import { TextInputSuggest } from "./suggest";
import {
	dispatchCompletion,
	normalizeDisplayItem,
	normalizeQuery,
	renderHighlightRanges,
	stripMdExtensionForDisplay,
} from "./utils";

export class GenericTextSuggester extends TextInputSuggest<string> {
	// Match ranges of the last suggestions, for highlighting.
	private matchesByItem = new Map<string, SearchMatches>();

	constructor(
		public app: App,
		public inputEl: HTMLInputElement | HTMLTextAreaElement,
		private items: string[],
		private maxSuggestions = Infinity
	) {
		super(app, inputEl);
		this.items = items.map((item) => normalizeDisplayItem(item));
	}

	getSuggestions(inputStr: string): string[] {
		const ranked = rankMatches(normalizeQuery(inputStr), this.items, (item) => item, {
			limit: this.maxSuggestions,
		});
		this.matchesByItem = new Map(ranked.map(({ item, matches }) => [item, matches]));
		return ranked.map(({ item }) => item);
	}

	selectSuggestion(item: string): void {
		this.inputEl.value = item;
		dispatchCompletion(this.inputEl);
		this.close();
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		// Ranges past the hidden ".md" are clipped away.
		renderHighlightRanges(
			el,
			stripMdExtensionForDisplay(value),
			this.matchesByItem.get(value) ?? [],
		);
	}
}
