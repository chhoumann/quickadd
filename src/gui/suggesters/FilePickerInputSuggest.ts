import { prepareFuzzySearch, type App } from "obsidian";
import { TextInputSuggest } from "./suggest";

export interface FilePickerOption {
	value: string;
	label: string;
	path: string;
	isCustom?: boolean;
}

type CompletionInputEvent = Event & {
	fromCompletion?: boolean;
	keepOpen?: boolean;
};

const MAX_RESULTS = 200;

/**
 * Searchable inline FILE picker used by the one-page form. Unlike the generic
 * multi suggester, this control never serializes selections into comma-separated
 * display text: the owner receives the exact option value (an encoded file path,
 * or a literal custom value) for every pick.
 */
export class FilePickerInputSuggest extends TextInputSuggest<FilePickerOption> {
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

		if (!trimmed) return available.slice(0, MAX_RESULTS);

		const fuzzy = prepareFuzzySearch(trimmed);
		const matches = available
			.map((option) => ({
				option,
				match: fuzzy(`${option.label} ${option.path}`),
			}))
			.filter(
				(entry): entry is typeof entry & {
					match: NonNullable<typeof entry.match>;
				} =>
					entry.match !== null,
			)
			.sort((a, b) => b.match.score - a.match.score)
			.slice(0, MAX_RESULTS)
			.map(({ option }) => option);

		if (!this.allowCustomInput) return matches;

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
		if (option.isCustom) {
			primary.setText(option.label);
		} else {
			this.renderMatch(primary, option.label, this.getCurrentQuery().trim());
		}
		text.createDiv({
			cls: "qa-onepage-file-suggestion__path",
			text: option.path,
		});
	}

	selectSuggestion(option: FilePickerOption): void {
		this.onSelect(option);
		this.inputEl.value = "";

		if (!this.multiSelect) {
			this.close();
			return;
		}

		const event = new Event("input", { bubbles: true }) as CompletionInputEvent;
		event.fromCompletion = true;
		event.keepOpen = true;
		this.inputEl.dispatchEvent(event);
		this.inputEl.focus();
	}
}
