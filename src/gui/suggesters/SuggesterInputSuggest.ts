import type { App } from "obsidian";
import { TextInputSuggest } from "./suggest";

export class SuggesterInputSuggest extends TextInputSuggest<string> {
	private options: string[];
	private caseSensitive: boolean;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		options: string[],
		caseSensitive = false,
	) {
		super(app, inputEl);
		this.options = options;
		this.caseSensitive = caseSensitive;
	}

	getSuggestions(query: string): string[] {
		const searchQuery = this.caseSensitive ? query : query.toLowerCase();

		if (!searchQuery) {
			return this.options.slice(0, 200);
		}

		return this.options
			.filter((opt) => {
				const optStr = this.caseSensitive ? opt : opt.toLowerCase();
				return optStr.includes(searchQuery);
			})
			.slice(0, 200);
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		el.innerHTML = this.renderMatch(item, this.getCurrentQuery());
	}

	selectSuggestion(item: string): void {
		this.inputEl.value = item;
		const event = new Event("input", { bubbles: true });
		(event as any).fromCompletion = true;
		this.inputEl.dispatchEvent(event);
		this.close();
	}
}
