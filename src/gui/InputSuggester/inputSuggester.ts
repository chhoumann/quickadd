import { FuzzySuggestModal } from "obsidian";
import type { FuzzyMatch, App } from "obsidian";

type SuggestRender<T> = (value: T, el: HTMLElement) => void;

type Options = {
	limit: FuzzySuggestModal<string>["limit"];
	emptyStateText: FuzzySuggestModal<string>["emptyStateText"];
	placeholder: Parameters<
		FuzzySuggestModal<string>["setPlaceholder"]
	>[0] extends string
		? string
		: never;
	renderItem: SuggestRender<string> | undefined;
};

/**
 * Similar to GenericSuggester, except users can write their own input, and it gets added to the list of suggestions.
 */
export default class InputSuggester extends FuzzySuggestModal<string> {
	private resolvePromise: (value: string) => void;
	private rejectPromise: (reason?: unknown) => void;
	public promise: Promise<string>;
	private resolved: boolean;

	private renderItem?: SuggestRender<string>;

	public static Suggest(
		app: App,
		displayItems: string[],
		items: string[],
		options: Partial<Options> = {}
	) {
		const newSuggester = new InputSuggester(
			app,
			displayItems,
			items,
			options
		);
		return newSuggester.promise;
	}

	public constructor(
		app: App,
		private displayItems: string[],
		private items: string[],
		options: Partial<Options> = {}
	) {
		super(app);

		this.promise = new Promise<string>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});

		this.renderItem = options.renderItem;

		this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
			// chooser is undocumented & not officially a part of the Obsidian API, hence the precautions in using it.
			if (event.code !== "Tab" || !("chooser" in this)) {
				return;
			}

			const { values, selectedItem } = this.chooser as {
				values: {
					item: string;
					match: { score: number; matches: unknown[] };
				}[];
				selectedItem: number;
				[key: string]: unknown;
			};

			const { value } = this.inputEl;
			this.inputEl.value = values[selectedItem].item ?? value;
		});

		if (options.placeholder) this.setPlaceholder(options.placeholder);
		if (options.limit) this.limit = options.limit;
		if (options.emptyStateText)
			this.emptyStateText = options.emptyStateText;

		this.open();
	}

	getItemText(item: string): string {
		if (item === this.inputEl.value) return item;

		return this.displayItems[this.items.indexOf(item)];
	}

	getItems(): string[] {
		return this.items;
	}

	getSuggestions(query: string): FuzzyMatch<string>[] {
		const suggestions = super.getSuggestions(query);
		const customValue = this.inputEl.value;

		if (!customValue) return suggestions;

		if (this.items.includes(customValue)) {
			return suggestions;
		}

		const alreadyPresent = suggestions.some(
			(suggestion) => suggestion.item === customValue
		);

		if (alreadyPresent) {
			return suggestions;
		}

		suggestions.push({
			item: customValue,
			match: {
				score: Number.NEGATIVE_INFINITY,
				matches: [],
			},
		});

		return suggestions;
	}

	selectSuggestion(
		value: FuzzyMatch<string>,
		evt: MouseEvent | KeyboardEvent
	) {
		this.resolved = true;
		super.selectSuggestion(value, evt);
	}

	renderSuggestion(value: FuzzyMatch<string>, el: HTMLElement): void {
		if (!this.renderItem) {
			super.renderSuggestion(value, el);
			return;
		}

		try {
			el.empty();
			this.renderItem(value.item, el);
		} catch {
			el.empty();
			super.renderSuggestion(value, el);
		}
	}

	onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
		this.resolved = true;
		this.resolvePromise(item);
	}

	onClose() {
		super.onClose();

		if (!this.resolved) this.rejectPromise("no input given.");
	}
}
