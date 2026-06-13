import { FuzzySuggestModal, setIcon } from "obsidian";
import type { FuzzyMatch, App } from "obsidian";
import { log, toError } from "src/logger/logManager";
import {
	installSkipAffordance,
	normalizeDisplayItem,
	normalizeQuery,
} from "../suggesters/utils";

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
	/** Adds a "skip" affordance that resolves "" (for optional tokens). */
	skippable: boolean;
	/**
	 * When false, the typed value is not offered as a custom ("create") suggestion.
	 * Defaults to true to preserve the historical "type your own input" behaviour.
	 */
	allowCustomValue: boolean;
	/**
	 * Renders the typed-but-unmatched custom row with a label, e.g.
	 * `(value) => \`Create new note: ${value}\``. Implies a "create" affordance.
	 */
	customValueLabel: (value: string) => string;
	/**
	 * Suppresses the custom row when the typed value already maps to a selectable
	 * target the caller recognises (e.g. an existing file reached by basename).
	 */
	valueExists: (value: string) => boolean;
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
	private displayItems: string[];
	private items: string[];
	private warnedOnEmptyDisplay = false;
	private allowCustomValue = true;
	private customValueLabel?: (value: string) => string;
	private valueExists?: (value: string) => boolean;

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
		displayItems: string[],
		items: string[],
		options: Partial<Options> = {}
	) {
		super(app);

		this.items = items;
		this.displayItems = displayItems.map((value) => normalizeDisplayItem(value));

		this.promise = new Promise<string>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});

		this.renderItem = options.renderItem;
		this.allowCustomValue = options.allowCustomValue ?? true;
		this.customValueLabel = options.customValueLabel;
		this.valueExists = options.valueExists;

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
		if (typeof options.limit === "number") {
			this.limit = options.limit;
		}
		if (options.emptyStateText)
			this.emptyStateText = options.emptyStateText;

		if (this.displayItems.length !== this.items.length) {
			this.displayItems = this.items.map((item, index) => {
				const displayItem = this.displayItems[index];
				return normalizeDisplayItem(displayItem ?? item);
			});
		}

		if (options.skippable) {
			installSkipAffordance(this, () => this.skip());
		}

		this.warnIfEmptyDisplay();
		this.open();
	}

	getItemText(item: string): string {
		if (item === this.inputEl.value) return item;

		const index = this.items.indexOf(item);
		const displayItem = index >= 0 ? this.displayItems[index] : undefined;
		return normalizeDisplayItem(displayItem ?? item);
	}

	getItems(): string[] {
		return this.items;
	}

	getSuggestions(query: string): FuzzyMatch<string>[] {
		const safeQuery = normalizeQuery(query);
		const suggestions = super.getSuggestions(safeQuery);

		if (!this.allowCustomValue) return suggestions;

		const customValue = normalizeQuery(this.inputEl.value);

		if (!customValue) return suggestions;

		if (this.items.includes(customValue)) {
			return suggestions;
		}

		// Capture pickers pass valueExists to suppress the "create" row when the typed
		// value already resolves to an existing note (by basename or full path, with or
		// without extension). This is intentionally NOT a displayItems check: generic
		// callers (e.g. api.suggester, |text format syntax) use arbitrary display labels
		// that are not existing targets, and must keep their typed value submittable.
		if (this.valueExists?.(customValue)) {
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
		// The custom ("create") row is the only entry scored -Infinity; when a label
		// is configured it takes precedence over any caller-provided renderItem.
		if (
			this.customValueLabel &&
			value.match.score === Number.NEGATIVE_INFINITY
		) {
			this.renderCustomValue(value.item, el);
			return;
		}

		if (!this.renderItem) {
			super.renderSuggestion(value, el);
			return;
		}

		try {
			el.empty();
			this.renderItem(value.item, el);
		} catch (error) {
			const err = toError(error);
			err.message = `Custom renderItem threw an error; falling back to default rendering. ${err.message}`;
			log.logWarning(err);
			el.empty();
			super.renderSuggestion(value, el);
		}
	}

	private renderCustomValue(value: string, el: HTMLElement): void {
		try {
			el.empty();
			el.addClass("mod-complex");
			const content = el.createDiv({ cls: "suggestion-content" });
			content.createDiv({
				cls: "suggestion-title",
				text: this.customValueLabel?.(value) ?? value,
			});
			const aux = el.createDiv({ cls: "suggestion-aux" });
			setIcon(aux.createSpan({ cls: "suggestion-flair" }), "file-plus");
		} catch (error) {
			const err = toError(error);
			err.message = `Custom create-row rendering threw an error; falling back to default rendering. ${err.message}`;
			log.logWarning(err);
			el.empty();
			super.renderSuggestion(
				{ item: value, match: { score: 0, matches: [] } },
				el,
			);
		}
	}

	onChooseItem(item: string, evt: MouseEvent | KeyboardEvent): void {
		this.resolved = true;
		this.resolvePromise(item);
	}

	/** Resolves "" as an intentional "leave empty" answer. */
	public skip(): void {
		this.resolved = true;
		this.resolvePromise("");
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
