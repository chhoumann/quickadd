import { FuzzySuggestModal } from "obsidian";
import type { FuzzyMatch, App } from "obsidian";

type SuggestRender<T> = (value: T, el: HTMLElement) => void;

export default class GenericSuggester<T> extends FuzzySuggestModal<T> {
	private resolvePromise: (value: T) => void;
	private rejectPromise: (reason?: unknown) => void;
	public promise: Promise<T>;
	private resolved: boolean;

	private renderItem?: SuggestRender<T>;


	public static Suggest<T>(
		app: App,
		displayItems: string[],
		items: T[],
		placeholder?: string,
		renderItem?: SuggestRender<T>,
	) {
		const newSuggester = new GenericSuggester(app, displayItems, items, renderItem);
		if (placeholder) newSuggester.setPlaceholder(placeholder);
		return newSuggester.promise;
	}

	public constructor(
		app: App,
		private displayItems: string[],
		private items: T[],
		renderItem?: SuggestRender<T>,
	) {
		super(app);

		this.renderItem = renderItem;

		this.promise = new Promise<T>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});

		this.inputEl.addEventListener("keydown", (event: KeyboardEvent) => {
			// chooser is undocumented & not officially a part of the Obsidian API, hence the precautions in using it.
			if (event.code !== "Tab" || !("chooser" in this)) {
				return;
			}

			const { values, selectedItem } = this.chooser as {
				values: {
					item: string;
					match: { score: number; matches: unknown[]; };
				}[];
				selectedItem: number;
				[key: string]: unknown;
			};

			const { value } = this.inputEl;
			this.inputEl.value = values[selectedItem].item ?? value;
		});

		this.open();
	}

	getItemText(item: T): string {
		return this.displayItems[this.items.indexOf(item)];
	}

	getItems(): T[] {
		return this.items;
	}

	selectSuggestion(
		value: FuzzyMatch<T>,
		evt: MouseEvent | KeyboardEvent
	) {
		this.resolved = true;
		super.selectSuggestion(value, evt);
	}

	renderSuggestion(value: FuzzyMatch<T>, el: HTMLElement): void {
		if (!this.renderItem) {
			// default rendering with fuzzy highlights
			super.renderSuggestion(value, el);
			return;
		}

		try {
			el.empty();
			this.renderItem(value.item, el);
		} catch (e) {
			// Fallback to default rendering if custom render throws
			el.empty();
			super.renderSuggestion(value, el);
		}
	}

	onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void {
		this.resolved = true;
		this.resolvePromise(item);
	}

	onClose() {
		super.onClose();

		if (!this.resolved) this.rejectPromise("no input given.");
	}
}
