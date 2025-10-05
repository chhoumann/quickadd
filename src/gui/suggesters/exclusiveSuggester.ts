import { TextInputSuggest } from "./suggest";
import type { App } from "obsidian";

export class ExclusiveSuggester extends TextInputSuggest<string> {
	constructor(
		public app: App,
		public inputEl: HTMLInputElement | HTMLTextAreaElement,
		private suggestItems: string[],
		_currentItems: string[]
	) {
		super(app, inputEl);
	}

	updateCurrentItems(currentItems: string[]) {
		this.currentItems = currentItems;
	}

	getSuggestions(inputStr: string): string[] {
		return this.suggestItems.filter((item) => item.contains(inputStr));
	}

	selectSuggestion(item: string): void {
		this.inputEl.value = item;
		this.inputEl.trigger("input");
		this.close();
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		if (value) el.setText(value);
	}
}
