import type { App, SearchMatches } from "obsidian";
import {
	FieldSuggestionParser,
	type FieldFilter,
} from "src/utils/FieldSuggestionParser";
import {
	collectFieldValuesProcessed,
} from "src/utils/FieldValueCollector";
import { rankMatches } from "./rankMatches";
import { TextInputSuggest } from "./suggest";
import { dispatchCompletion, renderHighlightRanges } from "./utils";

const MAX_RESULTS = 200;

export class FieldValueInputSuggest extends TextInputSuggest<string> {
	private readonly fieldInput: string;
	private readonly fieldName: string;
	private readonly filters: FieldFilter;
	// Match ranges of the last suggestions, for highlighting.
	private matchesByItem = new Map<string, SearchMatches>();
	private lookupSequence = 0;

	constructor(app: App, inputEl: HTMLInputElement, fieldInput: string) {
		super(app, inputEl);
		this.fieldInput = fieldInput;
		const parsed = FieldSuggestionParser.parse(fieldInput);
		this.fieldName = parsed.fieldName;
		this.filters = parsed.filters;
	}

	async getSuggestions(inputStr: string): Promise<string[]> {
		const lookup = ++this.lookupSequence;
		// FieldSuggestionCache already avoids repeated vault scans. Ask it on every
		// refresh so a metadata event that invalidated the shared cache is visible to
		// an already-open input instead of being shadowed by a second per-modal cache.
		const values = await collectFieldValuesProcessed(
			this.app,
			this.fieldName,
			this.filters,
		);

		// The lookup is async; one that a newer lookup has overtaken must not
		// replace the newer highlight ranges (the base class discards its items).
		if (lookup !== this.lookupSequence) return [];
		const ranked = rankMatches(inputStr, values, (value) => value, {
			limit: MAX_RESULTS,
		});
		this.matchesByItem = new Map(ranked.map(({ item, matches }) => [item, matches]));
		return ranked.map(({ item }) => item);
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		renderHighlightRanges(el, item, this.matchesByItem.get(item) ?? []);
	}

	selectSuggestion(item: string): void {
		// Fill input and dispatch a synthetic input event to trigger onChange listeners
		this.inputEl.value = item;
		dispatchCompletion(this.inputEl);
		this.close();
	}
}
