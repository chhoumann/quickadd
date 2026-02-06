import type { App } from "obsidian";
import { TextInputSuggest } from "./suggest";
import {
	normalizeDisplayItem,
	normalizeQuery,
	stripMdExtensionForDisplay,
} from "./utils";

export class GenericTextSuggester extends TextInputSuggest<string> {
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
		const inputLowerCase = normalizeQuery(inputStr).toLowerCase();

		const filtered = this.items.filter((item) => {
			return item.toLowerCase().includes(inputLowerCase);
		});

		if (filtered.length === 0) this.close();

		const limited = filtered.slice(0, this.maxSuggestions);

		return limited;
	}

	selectSuggestion(item: string): void {
		this.inputEl.value = item;
		this.inputEl.trigger("input");
		this.close();
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		if (!value) return;
		const displayValue = stripMdExtensionForDisplay(value);
		const displayQuery = stripMdExtensionForDisplay(this.getCurrentQuery());
		this.renderMatch(el, displayValue, displayQuery);
	}

	protected getCurrentQuery(): string {
		return this.inputEl.value;
	}
}
