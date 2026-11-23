import type { App } from "obsidian";
import { GenericTextSuggester } from "./genericTextSuggester";

/** A GenericTextSuggester that leaves out the items already chosen. */
export class ExclusiveSuggester extends GenericTextSuggester {
	constructor(
		app: App,
		inputEl: HTMLInputElement | HTMLTextAreaElement,
		suggestItems: string[],
		/** Read on every query, so the exclusions follow the live list. */
		private readonly currentItems: () => readonly string[],
	) {
		super(app, inputEl, suggestItems);
	}

	getSuggestions(inputStr: string): string[] {
		const chosen = this.currentItems();
		return super
			.getSuggestions(inputStr)
			.filter((item) => !chosen.includes(item));
	}
}
