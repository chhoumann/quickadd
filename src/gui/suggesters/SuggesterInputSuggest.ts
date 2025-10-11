import type { App } from "obsidian";
import { TextInputSuggest } from "./suggest";

export class SuggesterInputSuggest extends TextInputSuggest<string> {
	private options: string[];
	private caseSensitive: boolean;
	private multiSelect: boolean;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		options: string[],
		caseSensitive = false,
		multiSelect = false,
	) {
		super(app, inputEl);
		this.options = options;
		this.caseSensitive = caseSensitive;
		this.multiSelect = multiSelect;

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
		const { alreadySelected, activeTerm } = this.parseMultiSelectInput(query);
		const searchQuery = this.caseSensitive ? activeTerm : activeTerm.toLowerCase();

		const available = this.getRemainingOptions(alreadySelected);

		if (!searchQuery) {
			return available.slice(0, 200);
		}

		return available
			.filter((opt) => {
				const optStr = this.caseSensitive ? opt : opt.toLowerCase();
				return optStr.includes(searchQuery);
			})
			.slice(0, 200);
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		this.renderMatch(el, item, this.getCurrentQuery());
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
		const event = new Event("input", { bubbles: true });
		(event as any).fromCompletion = true;
		this.inputEl.dispatchEvent(event);
		this.close();
	}

	private selectMultipleItem(item: string): void {
		const { alreadySelected } = this.parseMultiSelectInput(this.inputEl.value);
		alreadySelected.push(item);

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

		// Trigger input event
		const event = new Event("input", { bubbles: true });
		(event as any).fromCompletion = true;

		// Only keep open if there are more items to select
		if (hasMoreItems) {
			(event as any).keepOpen = true;
			this.inputEl.dispatchEvent(event);
			// Force re-focus to trigger suggestions
			this.inputEl.focus();
		} else {
			// All items selected, close the dropdown
			this.inputEl.dispatchEvent(event);
			this.close();
		}
	}
}
