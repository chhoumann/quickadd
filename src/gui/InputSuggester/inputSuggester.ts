import { setIcon } from "obsidian";
import type { FuzzySuggestModal, FuzzyMatch, App } from "obsidian";
import {
	createRenderFallbackWarner,
	normalizeDisplayItem,
	normalizeQuery,
} from "../suggesters/utils";
import { SuggesterModal } from "../GenericSuggester/SuggesterModal";
import type { SuggestRender } from "../GenericSuggester/SuggesterModal";

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
	 * `(value) => \`Create new note: ${value}\``. Implies a "create" affordance
	 * that is placed first so Enter performs the labeled action.
	 */
	customValueLabel: (value: string) => string;
	/**
	 * Suppresses the custom row when the typed value already maps to a selectable
	 * target the caller recognises (e.g. an existing file reached by basename).
	 */
	valueExists: (value: string) => boolean;
	/**
	 * Optional text used for fuzzy matching. Visual rendering still comes from
	 * displayItems/renderItem; this lets file pickers search both title labels and
	 * vault paths.
	 */
	searchItems: string[];
};

/**
 * Similar to GenericSuggester, except users can write their own input, and it gets added to the list of suggestions.
 */
export default class InputSuggester extends SuggesterModal<string> {
	private searchItems: string[];
	private warnCustomValueFailure = createRenderFallbackWarner(
		"Custom create-row rendering threw an error; falling back to default rendering",
	);
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
		super(app, displayItems, items, options.renderItem, options);
		this.searchItems =
			options.searchItems?.map((value) => normalizeDisplayItem(value)) ?? [];

		this.allowCustomValue = options.allowCustomValue ?? true;
		this.customValueLabel = options.customValueLabel;
		this.valueExists = options.valueExists;

		if (options.placeholder) this.setPlaceholder(options.placeholder);
		if (typeof options.limit === "number") {
			this.limit = options.limit;
		}
		if (options.emptyStateText)
			this.emptyStateText = options.emptyStateText;

		if (this.searchItems.length !== this.items.length) {
			this.searchItems = this.items.map((item, index) => {
				return normalizeDisplayItem(
					this.searchItems[index] ?? this.displayItems[index] ?? item,
				);
			});
		}

		this.warnIfEmptyDisplay();
		this.open();
	}

	getItemText(item: string): string {
		if (item === this.inputEl.value) return item;

		const index = this.items.indexOf(item);
		const searchItem = index >= 0 ? this.searchItems[index] : undefined;
		return normalizeDisplayItem(searchItem ?? item);
	}

	getSuggestions(query: string): FuzzyMatch<string>[] {
		const suggestions = super.getSuggestions(query);

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

		const customSuggestion = {
			item: customValue,
			match: {
				score: Number.NEGATIVE_INFINITY,
				matches: [],
			},
		};

		if (this.customValueLabel) {
			suggestions.unshift(customSuggestion);
		} else {
			suggestions.push(customSuggestion);
		}

		return suggestions;
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

		super.renderSuggestion(value, el);
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
			this.warnCustomValueFailure(error);
			el.empty();
			this.renderDefaultSuggestion(
				{ item: value, match: { score: 0, matches: [] } },
				el,
			);
		}
	}

}
