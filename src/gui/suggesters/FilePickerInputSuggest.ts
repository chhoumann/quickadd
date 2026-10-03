import { setIcon, type App, type SearchMatches } from "obsidian";
import { rankMatches } from "./rankMatches";
import { TextInputSuggest } from "./suggest";
import { dispatchCompletion, renderHighlightRanges } from "./utils";
import { fileBasenameFromPath } from "../../utils/fileSyntax";

export interface FilePickerOption {
	value: string;
	label: string;
	path: string;
	isCustom?: boolean;
	/** The note's aliases, also matched; a match by one shows it. */
	aliases?: string[];
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
	private aliasByOption = new Map<FilePickerOption, string>();
	private namesByOption = new WeakMap<FilePickerOption, string[]>();

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly getOptions: () => FilePickerOption[],
		private readonly isSelected: (value: string) => boolean,
		private readonly onSelect: (option: FilePickerOption) => void,
		private readonly multiSelect: boolean,
		private readonly allowCustomInput: boolean,
		/**
		 * Set when a custom value names a new note (one-page Capture to): which
		 * names a note already has, so they aren't offered. The custom row then
		 * reads "Create new note", as in the run's picker.
		 */
		private readonly newNoteExists?: (value: string) => boolean,
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
			{ limit: MAX_RESULTS, aliases: (option) => option.aliases },
		);
		this.matchesByOption = new Map(ranked.map(({ item, matches }) => [item, matches]));
		this.aliasByOption = new Map(
			ranked.flatMap(({ item, alias }) => (alias !== undefined ? [[item, alias] as const] : [])),
		);
		const matches = ranked.map(({ item }) => item);
		if (!trimmed || !this.allowCustomInput) return matches;

		// Typing a file's name, label, path or alias picks that file, not a
		// custom value with the same name.
		const normalized = trimmed.toLocaleLowerCase();
		const exactOption = this.getOptions().some((option) =>
			this.namesOf(option).includes(normalized),
		);
		const exactCustom = this.isSelected(trimmed);
		if (exactOption || exactCustom || this.newNoteExists?.(trimmed)) return matches;

		return [
			this.newNoteExists
				? { value: trimmed, label: `Create new note: ${trimmed}`, path: "", isCustom: true }
				: { value: trimmed, label: `Use “${trimmed}”`, path: "Custom value", isCustom: true },
			...matches,
		].slice(0, MAX_RESULTS);
	}

	/** An option's names in lower case, cached: the custom-value check reads every option per keystroke. */
	private namesOf(option: FilePickerOption): string[] {
		let names = this.namesByOption.get(option);
		if (!names) {
			names = [
				option.label,
				option.path,
				...(option.isCustom ? [] : [fileBasenameFromPath(option.path)]),
				...(option.aliases ?? []),
			].map((name) => name.toLocaleLowerCase());
			this.namesByOption.set(option, names);
		}
		return names;
	}

	renderSuggestion(option: FilePickerOption, el: HTMLElement): void {
		el.addClass("qa-onepage-file-suggestion");
		const text = el.createDiv({ cls: "qa-onepage-file-suggestion__text" });
		const primary = text.createDiv({
			cls: "qa-onepage-file-suggestion__label",
		});
		if (option.isCustom && this.newNoteExists) {
			// As the run's Capture to picker shows it. A name picked earlier and
			// removed again comes back as a stored option labelled with the name.
			primary.setText(`Create new note: ${option.value}`);
			el.addClass("mod-complex");
			text.addClass("suggestion-content");
			setIcon(el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair" }), "file-plus");
			return;
		}
		const path = text.createDiv({ cls: "qa-onepage-file-suggestion__path" });
		if (option.isCustom) {
			primary.setText(option.label);
			path.setText(option.path);
			return;
		}
		const matches = this.matchesByOption.get(option) ?? [];
		const alias = this.aliasByOption.get(option);
		if (alias !== undefined) {
			// As in the quick switcher: the alias that matched, the note beneath.
			renderHighlightRanges(primary, alias, matches);
			path.setText(option.label);
			el.addClass("mod-complex");
			text.addClass("suggestion-content");
			const flair = el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair" });
			flair.setAttribute("aria-label", "Alias");
			setIcon(flair, "forward");
			return;
		}
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
