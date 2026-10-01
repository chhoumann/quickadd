import {
	FuzzySuggestModal,
	prepareFuzzySearch,
	renderMatches,
	setIcon,
	sortSearchResults,
} from "obsidian";
import type { FuzzyMatch, App, SearchMatches } from "obsidian";
import { log } from "src/logger/logManager";
import {
	createRenderFallbackWarner,
	installSkipAffordance,
	normalizeDisplayItem,
	normalizeQuery,
} from "../suggesters/utils";
import { promptCancelled } from "../../errors/UserCancelError";
import { matchWithAliases } from "../suggesters/rankMatches";

/** `matches` are the query's match ranges in the item's search text. */
export type SuggestRender<T> = (value: T, el: HTMLElement, matches: SearchMatches) => void;

export type GenericSuggesterOptions = {
	/**
	 * Adds a "skip" affordance that resolves the empty string instead of an
	 * item. Only enable for string-item suggesters (e.g. optional
	 * {{VALUE:a,b,c|optional}} tokens).
	 */
	skippable?: boolean;
	/**
	 * Other names each item can be found by, by index (a note's aliases). A row
	 * found by one shows that name, the way Obsidian's quick switcher does.
	 */
	aliases?: string[][];
};

export class SuggesterModal<T> extends FuzzySuggestModal<T> {
	private resolvePromise: (value: T) => void;
	private rejectPromise: (reason?: unknown) => void;
	public promise: Promise<T>;
	private resolved: boolean;

	private renderItem?: SuggestRender<T>;
	protected displayItems: string[];
	protected items: T[];
	// getItemText runs once per item per keystroke, so finding an item's index
	// with items.indexOf made every keystroke quadratic in the list's length.
	private indexByItem = new Map<T, number>();
	private aliases?: string[][];
	private aliasByMatch = new WeakMap<FuzzyMatch<T>, string>();
	private warnedOnEmptyDisplay = false;
	private warnRenderItemFailure = createRenderFallbackWarner(
		"Custom renderItem threw an error; falling back to default rendering",
	);

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
			this.inputEl.value = values[selectedItem]?.item ?? value;
		});

		if (this.displayItems.length !== this.items.length) {
			this.displayItems = this.items.map((item, index) => {
				const displayItem = this.displayItems[index];
				return normalizeDisplayItem(displayItem ?? item);
			});
		}

		this.items.forEach((item, index) => {
			if (!this.indexByItem.has(item)) this.indexByItem.set(item, index);
		});
		this.aliases = options?.aliases;
	}

	protected indexOfItem(item: T): number {
		return this.indexByItem.get(item) ?? -1;
	}

	/**
	 * `qa-suggester` is a stable hook for user CSS snippets; core styles every
	 * picker as `.prompt`, so without it a snippet can't tell QuickAdd's apart.
	 */
	onOpen(): void {
		super.onOpen();
		this.modalEl.addClass("qa-suggester");
	}

	getItemText(item: T): string {
		const index = this.indexOfItem(item);
		const displayItem = index >= 0 ? this.displayItems[index] : undefined;
		return normalizeDisplayItem(displayItem ?? item);
	}

	getItems(): T[] {
		return this.items;
	}

	getSuggestions(query: string): FuzzyMatch<T>[] {
		const safeQuery = normalizeQuery(query);
		if (!this.aliases || !safeQuery.trim()) return super.getSuggestions(safeQuery);

		// One row per item, found by its text or any of its aliases.
		const search = prepareFuzzySearch(safeQuery.trim());
		const results: FuzzyMatch<T>[] = [];
		this.items.forEach((item, index) => {
			const found = matchWithAliases(search, this.getItemText(item), this.aliases?.[index]);
			if (!found) return;
			const result = { item, match: found.result };
			if (found.alias !== undefined) this.aliasByMatch.set(result, found.alias);
			results.push(result);
		});
		sortSearchResults(results);
		return results;
	}

	selectSuggestion(
		value: FuzzyMatch<T>,
		evt: MouseEvent | KeyboardEvent
	) {
		this.resolved = true;
		super.selectSuggestion(value, evt);
	}

	renderSuggestion(value: FuzzyMatch<T>, el: HTMLElement): void {
		const alias = this.aliasByMatch.get(value);
		if (alias !== undefined) {
			this.renderAliasSuggestion(value, alias, el);
			return;
		}

		if (!this.renderItem) {
			// default rendering with fuzzy highlights
			super.renderSuggestion(value, el);
			return;
		}

		try {
			el.empty();
			this.renderItem(value.item, el, value.match.matches);
		} catch (error) {
			// Fallback to default rendering if custom render throws
			this.warnRenderItemFailure(error);
			el.empty();
			super.renderSuggestion(value, el);
		}
	}

	/** The alias that matched, with the item's own name beneath, as in the quick switcher. */
	private renderAliasSuggestion(value: FuzzyMatch<T>, alias: string, el: HTMLElement): void {
		el.empty();
		el.addClass("mod-complex");
		const content = el.createDiv({ cls: "suggestion-content" });
		renderMatches(content.createDiv({ cls: "suggestion-title" }), alias, value.match.matches);
		const index = this.indexOfItem(value.item);
		content.createDiv({ cls: "suggestion-note", text: this.displayItems[index] ?? "" });
		const flair = el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair" });
		flair.setAttribute("aria-label", "Alias");
		setIcon(flair, "forward");
	}

	protected renderDefaultSuggestion(value: FuzzyMatch<T>, el: HTMLElement): void {
		super.renderSuggestion(value, el);
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

		if (!this.resolved) this.rejectPromise(promptCancelled());
	}

	protected warnIfEmptyDisplay(): void {
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
