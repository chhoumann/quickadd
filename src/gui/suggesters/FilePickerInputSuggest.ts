import type { App, SearchMatches } from "obsidian";
import { rankMatches } from "./rankMatches";
import { TextInputSuggest } from "./suggest";
import { dispatchCompletion, renderHighlightRanges } from "./utils";

export interface FilePickerOption {
	value: string;
	label: string;
	path: string;
	isCustom?: boolean;
}

const MAX_RESULTS = 200;

/**
 * Searchable inline FILE picker used by the one-page form. Unlike the generic
 * multi suggester, this control never serializes selections into comma-separated
 * display text: the owner receives the exact option value (an encoded file path,
 * or a literal custom value) for every pick.
 */
export class FilePickerInputSuggest extends TextInputSuggest<FilePickerOption> {
	// Match ranges of the last suggestions, over "label path", for highlighting.
	private matchesByOption = new Map<FilePickerOption, SearchMatches>();

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly getOptions: () => FilePickerOption[],
		private readonly isSelected: (value: string) => boolean,
		private readonly onSelect: (option: FilePickerOption) => void,
		private readonly multiSelect: boolean,
		private readonly allowCustomInput: boolean,
	) {
		super(app, inputEl);
		if (multiSelect) inputEl.setAttribute("aria-multiselectable", "true");
	}

	getSuggestions(query: string): FilePickerOption[] {
		const trimmed = query.trim();
		const available = this.getOptions().filter(
			(option) => !this.isSelected(option.value),
		);

		const ranked = rankMatches(
			trimmed,
			available,
			(option) => `${option.label} ${option.path}`,
			{ limit: MAX_RESULTS },
		);
		this.matchesByOption = new Map(ranked.map(({ item, matches }) => [item, matches]));
		const matches = ranked.map(({ item }) => item);
		if (!trimmed || !this.allowCustomInput) return matches;

		const normalized = trimmed.toLocaleLowerCase();
		const exactOption = this.getOptions().some(
			(option) =>
				option.label.toLocaleLowerCase() === normalized ||
				option.path.toLocaleLowerCase() === normalized,
		);
		const exactCustom = this.isSelected(trimmed);
		if (exactOption || exactCustom) return matches;

		return [
			{
				value: trimmed,
				label: `Use “${trimmed}”`,
				path: "Custom value",
				isCustom: true,
			},
			...matches,
		].slice(0, MAX_RESULTS);
	}

	renderSuggestion(option: FilePickerOption, el: HTMLElement): void {
		el.addClass("qa-onepage-file-suggestion");
		const text = el.createDiv({ cls: "qa-onepage-file-suggestion__text" });
		const primary = text.createDiv({
			cls: "qa-onepage-file-suggestion__label",
		});
		const path = text.createDiv({ cls: "qa-onepage-file-suggestion__path" });
		if (option.isCustom) {
			primary.setText(option.label);
			path.setText(option.path);
			return;
		}
		const matches = this.matchesByOption.get(option) ?? [];
		renderHighlightRanges(primary, option.label, matches);
		renderHighlightRanges(path, option.path, matches, option.label.length + 1);
	}

	selectSuggestion(option: FilePickerOption): void {
		this.onSelect(option);
		this.inputEl.value = "";

		if (!this.multiSelect) {
			this.close();
			return;
		}

		dispatchCompletion(this.inputEl, true);
		this.inputEl.focus();
	}
}
