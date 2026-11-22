import type { App, Scope } from "obsidian";
import type { FieldLinkSuggestion } from "src/utils/fieldLinkValues";
import { renderFieldLinkSuggestion } from "../suggesters/renderFieldLinkSuggestion";
import { TextInputSuggest } from "../suggesters/suggest";

export class CustomValueSuggest extends TextInputSuggest<FieldLinkSuggestion> {
	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly suggestFor: (query: string) => FieldLinkSuggestion[],
		private readonly onPick: (suggestion: FieldLinkSuggestion) => void,
		parentScope: Scope,
	) {
		super(app, inputEl, parentScope);
	}

	isSuggestOpen(): boolean {
		return this.inputEl.getAttribute("aria-expanded") === "true";
	}

	getSuggestions(query: string): FieldLinkSuggestion[] {
		return this.suggestFor(query);
	}

	renderSuggestion(suggestion: FieldLinkSuggestion, el: HTMLElement): void {
		renderFieldLinkSuggestion(suggestion, el);
	}

	selectSuggestion(suggestion: FieldLinkSuggestion): void {
		this.close();
		this.onPick(suggestion);
	}
}
