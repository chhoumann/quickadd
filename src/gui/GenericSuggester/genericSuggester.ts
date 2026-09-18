import type { App } from "obsidian";
import { SuggesterModal } from "./SuggesterModal";
import type { GenericSuggesterOptions, SuggestRender } from "./SuggesterModal";

export default class GenericSuggester<T> extends SuggesterModal<T> {
	public static Suggest<T>(
		app: App,
		displayItems: string[],
		items: T[],
		placeholder?: string,
		renderItem?: SuggestRender<T>,
		options?: GenericSuggesterOptions,
	) {
		const newSuggester = new GenericSuggester(
			app,
			displayItems,
			items,
			renderItem,
			options,
		);
		if (placeholder) newSuggester.setPlaceholder(placeholder);
		return newSuggester.promise;
	}

	public constructor(
		app: App,
		displayItems: string[],
		items: T[],
		renderItem?: SuggestRender<T>,
		options?: GenericSuggesterOptions,
	) {
		super(app, displayItems, items, renderItem, options);
		this.warnIfEmptyDisplay();
		this.open();
	}
}
