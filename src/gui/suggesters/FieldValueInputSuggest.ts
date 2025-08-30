import type { App } from "obsidian";
import {
	FieldSuggestionParser,
	type FieldFilter,
} from "src/utils/FieldSuggestionParser";
import {
	collectFieldValuesProcessed
} from "src/utils/FieldValueCollector";
import { TextInputSuggest } from "./suggest";

export class FieldValueInputSuggest extends TextInputSuggest<string> {
	private readonly fieldInput: string;
	private readonly fieldName: string;
	private readonly filters: FieldFilter;
	private cachedValues: string[] | null = null;

	constructor(app: App, inputEl: HTMLInputElement, fieldInput: string) {
		super(app, inputEl);
		this.fieldInput = fieldInput;
		const parsed = FieldSuggestionParser.parse(fieldInput);
		this.fieldName = parsed.fieldName;
		this.filters = parsed.filters;
	}

	async getSuggestions(inputStr: string): Promise<string[]> {
		if (!this.cachedValues) {
			this.cachedValues = await collectFieldValuesProcessed(
				this.app,
				this.fieldName,
				this.filters,
			);
		}

		const query = (inputStr || "").toLowerCase();
		if (!query) return this.cachedValues.slice(0, 200);
		return this.cachedValues
			.filter((v) => v.toLowerCase().includes(query))
			.slice(0, 200);
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		el.innerHTML = this.renderMatch(item, this.getCurrentQuery());
	}

	selectSuggestion(item: string): void {
		// Fill input and dispatch a synthetic input event to trigger onChange listeners
		this.inputEl.value = item;
		const event = new Event("input", { bubbles: true });
		(event as any).fromCompletion = true;
		this.inputEl.dispatchEvent(event);
		this.close();
	}

	private escapeRegex(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
}
