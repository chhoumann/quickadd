import { FuzzySuggestModal } from "obsidian";
import type { FuzzyMatch, App } from "obsidian";
import { log, toError } from "src/logger/logManager";
import {
	installSkipAffordance,
	normalizeDisplayItem,
	normalizeQuery,
} from "../suggesters/utils";

type SuggestRender<T> = (value: T, el: HTMLElement) => void;

type GenericSuggesterOptions = {
	/**
	 * Adds a "skip" affordance that resolves the empty string instead of an
	 * item. Only enable for string-item suggesters (e.g. optional
	 * {{VALUE:a,b,c|optional}} tokens).
	 */
	skippable?: boolean;
};

export default class GenericSuggester<T> extends FuzzySuggestModal<T> {
	private resolvePromise: (value: T) => void;
	private rejectPromise: (reason?: unknown) => void;
	public promise: Promise<T>;
	private resolved: boolean;

	private renderItem?: SuggestRender<T>;
	private displayItems: string[];
	private items: T[];
	private warnedOnEmptyDisplay = false;


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
		super(app);

		this.renderItem = renderItem;
		this.items = items;
		this.displayItems = displayItems.map((value) => normalizeDisplayItem(value));

		this.promise = new Promise<T>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});

		if (options?.skippable) {
			installSkipAffordance(this, () => this.skip());
		}

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

		if (this.displayItems.length !== this.items.length) {
			this.displayItems = this.items.map((item, index) => {
				const displayItem = this.displayItems[index];
				return normalizeDisplayItem(displayItem ?? item);
			});
		}

		this.warnIfEmptyDisplay();
		this.open();
	}

	getItemText(item: T): string {
		const index = this.items.indexOf(item);
		const displayItem = index >= 0 ? this.displayItems[index] : undefined;
		return normalizeDisplayItem(displayItem ?? item);
	}

	getItems(): T[] {
		return this.items;
	}

	getSuggestions(query: string): FuzzyMatch<T>[] {
		const safeQuery = normalizeQuery(query);
		return super.getSuggestions(safeQuery);
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
		} catch (error) {
			// Fallback to default rendering if custom render throws
			const err = toError(error);
			err.message = `Custom renderItem threw an error; falling back to default rendering. ${err.message}`;
			log.logWarning(err);
			el.empty();
			super.renderSuggestion(value, el);
		}
	}

	onChooseItem(item: T, evt: MouseEvent | KeyboardEvent): void {
		this.resolved = true;
		this.resolvePromise(item);
	}

	/** Resolves the empty string as an intentional "leave empty" answer. */
	public skip(): void {
		this.resolved = true;
		// Safe by contract: skippable is only enabled for string-item suggesters.
		this.resolvePromise("" as unknown as T);
		this.close();
	}

	onClose() {
		super.onClose();

		if (!this.resolved) this.rejectPromise("no input given.");
	}

	private warnIfEmptyDisplay(): void {
		if (this.warnedOnEmptyDisplay) return;

		const hasEmptyDisplay = this.displayItems.some(
			(displayItem) => displayItem.length === 0,
		);

		if (hasEmptyDisplay) {
			this.warnedOnEmptyDisplay = true;
			log.logWarning(
				"QuickAdd suggester received empty display values. Check your displayItems mapping.",
			);
		}
	}
}
