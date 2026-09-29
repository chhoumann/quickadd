import type { App } from "obsidian";
import { GenericTextSuggester } from "./genericTextSuggester";

/** A GenericTextSuggester that leaves out the items already chosen. */
export class ExclusiveSuggester extends GenericTextSuggester {
	constructor(
		app: App,
		inputEl: HTMLInputElement | HTMLTextAreaElement,
		suggestItems: string[],
		private currentItems: string[]
	) {
		super(app, inputEl, suggestItems);
	}

	updateCurrentItems(currentItems: string[]) {
		this.currentItems = currentItems;
	}

	getSuggestions(inputStr: string): string[] {
		return super
			.getSuggestions(inputStr)
			.filter((item) => !this.currentItems.includes(item));
	}
}
