import type { App } from "obsidian";
import {
	FieldSuggestionParser,
	type FieldFilter,
} from "src/utils/FieldSuggestionParser";
import {
	collectFieldValuesProcessed
} from "src/utils/FieldValueCollector";
import { TextInputSuggest } from "./suggest";

export const FIELD_MULTI_VALUES_DATA_KEY = "quickaddFieldMultiValues";

type CompletionInputEvent = Event & {
	fromCompletion?: boolean;
	keepOpen?: boolean;
};

export class FieldValueInputSuggest extends TextInputSuggest<string> {
	private readonly fieldInput: string;
	private readonly fieldName: string;
	private readonly filters: FieldFilter;
	private cachedValues: string[] | null = null;
	private readonly multiSelect: boolean;

	constructor(app: App, inputEl: HTMLInputElement, fieldInput: string) {
		super(app, inputEl);
		this.fieldInput = fieldInput;
		const parsed = FieldSuggestionParser.parse(fieldInput);
		this.fieldName = parsed.fieldName;
		this.filters = parsed.filters;
		this.multiSelect = parsed.filters.multiSelect ?? false;
		if (this.multiSelect) {
			this.inputEl.setAttribute("aria-multiselectable", "true");
		}
	}

	async getSuggestions(inputStr: string): Promise<string[]> {
		if (!this.cachedValues) {
			this.cachedValues = await collectFieldValuesProcessed(
				this.app,
				this.fieldName,
				this.filters,
			);
		}

		const { alreadySelected, activeTerm } = this.parseMultiSelectInput(inputStr || "");
		const available = this.cachedValues.filter(
			(value) => !alreadySelected.includes(value),
		);
		const query = activeTerm.toLowerCase();
		if (!query) return available.slice(0, 200);
		return available
			.filter((v) => v.toLowerCase().includes(query))
			.slice(0, 200);
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		this.renderMatch(
			el,
			item,
			this.parseMultiSelectInput(this.getCurrentQuery()).activeTerm,
		);
	}

	selectSuggestion(item: string): void {
		if (this.multiSelect) {
			this.selectMultipleItem(item);
			return;
		}

		// Fill input and dispatch a synthetic input event to trigger onChange listeners
		this.inputEl.value = item;
		const event = new Event("input", { bubbles: true });
		(event as CompletionInputEvent).fromCompletion = true;
		this.inputEl.dispatchEvent(event);
		this.close();
	}

	private parseMultiSelectInput(input: string): {
		alreadySelected: string[];
		activeTerm: string;
	} {
		if (!this.multiSelect) {
			return { alreadySelected: [], activeTerm: input };
		}

		const parts = input.split(",").map((part) => part.trim());
		return {
			alreadySelected: parts.slice(0, -1).filter(Boolean),
			activeTerm: parts[parts.length - 1] || "",
		};
	}

	private selectMultipleItem(item: string): void {
		const { alreadySelected } = this.parseMultiSelectInput(this.inputEl.value);
		alreadySelected.push(item);
		this.inputEl.dataset[FIELD_MULTI_VALUES_DATA_KEY] =
			JSON.stringify(alreadySelected);

		const hasMoreItems = Boolean(
			this.cachedValues?.some((value) => !alreadySelected.includes(value)),
		);

		this.inputEl.value = hasMoreItems
			? alreadySelected.join(", ") + ", "
			: alreadySelected.join(", ");
		this.inputEl.setSelectionRange(
			this.inputEl.value.length,
			this.inputEl.value.length,
		);

		const event = new Event("input", { bubbles: true });
		const completionEvent = event as CompletionInputEvent;
		completionEvent.fromCompletion = true;
		if (hasMoreItems) {
			completionEvent.keepOpen = true;
		}
		this.inputEl.dispatchEvent(event);
		if (hasMoreItems) {
			this.inputEl.focus();
		} else {
			this.close();
		}
	}

	private escapeRegex(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
}
