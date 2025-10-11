import { TextInputSuggest } from "./suggest";
import type { App } from "obsidian";

export class GenericTextSuggester extends TextInputSuggest<string> {
	constructor(
		public app: App,
		public inputEl: HTMLInputElement | HTMLTextAreaElement,
		private items: string[],
		private maxSuggestions = Infinity
	) {
		super(app, inputEl);
	}

	getSuggestions(inputStr: string): string[] {
		const inputLowerCase: string = inputStr.toLowerCase();

		const filtered = this.items.filter((item) => {
			return item.toLowerCase().includes(inputLowerCase);
		});

		if (!filtered) this.close();

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
		this.renderMatch(el, value, this.getCurrentQuery());
	}

	protected getCurrentQuery(): string {
		return this.inputEl.value;
	}
}
