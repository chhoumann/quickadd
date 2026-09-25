import type { App, SearchMatches } from "obsidian";
import { rankMatches } from "./rankMatches";
import { TextInputSuggest } from "./suggest";
import {
	dispatchCompletion,
	normalizeDisplayItem,
	normalizeQuery,
	renderHighlightRanges,
} from "./utils";

const MAX_RESULTS = 200;

export class SuggesterInputSuggest extends TextInputSuggest<string> {
	private options: string[];
	private caseSensitive: boolean;
	private multiSelect: boolean;
	// Match ranges of the last suggestions, for highlighting.
	private matchesByItem = new Map<string, SearchMatches>();
	// Fires with the exact item picked on each multi-select selection. The
	// resulting ", "-joined input text is ambiguous when an option's label equals
	// the join of two other option labels (e.g. "a", "b", and "a, b"); the
	// per-pick event lets callers record an unambiguous ordered selection.
	private onSelect?: (item: string) => void;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		options: string[],
		caseSensitive = false,
		multiSelect = false,
		onSelect?: (item: string) => void,
	) {
		super(app, inputEl);
		this.options = options.map((option) => normalizeDisplayItem(option));
		this.caseSensitive = caseSensitive;
		this.multiSelect = multiSelect;
		this.onSelect = onSelect;

		// Add accessibility attribute for multi-select mode
		if (this.multiSelect) {
			this.inputEl.setAttribute("aria-multiselectable", "true");
		}
	}

	private parseMultiSelectInput(input: string): {
		alreadySelected: string[];
		activeTerm: string;
	} {
		if (!this.multiSelect) {
			return { alreadySelected: [], activeTerm: input };
		}

		const parts = input.split(",").map((s) => s.trim());
		return {
			alreadySelected: parts.slice(0, -1).filter(Boolean),
			activeTerm: parts[parts.length - 1] || "",
		};
	}

	private getRemainingOptions(alreadySelected: string[]): string[] {
		return this.options.filter((opt) => !alreadySelected.includes(opt));
	}

	getSuggestions(query: string): string[] {
		const safeQuery = normalizeQuery(query);
		const { alreadySelected, activeTerm } = this.parseMultiSelectInput(safeQuery);
		const available = this.getRemainingOptions(alreadySelected);

		const ranked = rankMatches(activeTerm, available, (option) => option, {
			limit: MAX_RESULTS,
			caseSensitive: this.caseSensitive,
		});
		this.matchesByItem = new Map(ranked.map(({ item, matches }) => [item, matches]));
		return ranked.map(({ item }) => item);
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		renderHighlightRanges(el, item, this.matchesByItem.get(item) ?? []);
	}

	selectSuggestion(item: string): void {
		if (this.multiSelect) {
			this.selectMultipleItem(item);
		} else {
			this.selectSingleItem(item);
		}
	}

	private selectSingleItem(item: string): void {
		this.inputEl.value = item;
		dispatchCompletion(this.inputEl);
		this.close();
	}

	private selectMultipleItem(item: string): void {
		const { alreadySelected } = this.parseMultiSelectInput(this.inputEl.value);
		alreadySelected.push(item);

		// Report the exact picked item so callers can keep an unambiguous ordered
		// selection (the joined text alone can't distinguish picking "a" then "b"
		// from picking a single option literally named "a, b").
		this.onSelect?.(item);

		const hasMoreItems = this.getRemainingOptions(alreadySelected).length > 0;

		// Set value with trailing comma and space only if more items available
		this.inputEl.value = hasMoreItems
			? alreadySelected.join(", ") + ", "
			: alreadySelected.join(", ");

		// Move cursor to end
		this.inputEl.setSelectionRange(
			this.inputEl.value.length,
			this.inputEl.value.length,
		);

		dispatchCompletion(this.inputEl, hasMoreItems);
		if (hasMoreItems) this.inputEl.focus();
		else this.close();
	}
}
