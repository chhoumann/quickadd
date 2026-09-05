import { Notice, prepareFuzzySearch, type App } from "obsidian";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import {
	buildDiscoveryCandidates,
	selectionForDiscoveryCandidate,
	type TemplateNoteSelection,
} from "src/utils/templateNoteDiscovery";
import { TextInputSuggest } from "./suggest";

type NoteOption = {
	item: string;
	label: string;
	detail: string;
	search: string;
};

export class NoteDiscoveryInputSuggest extends TextInputSuggest<NoteOption> {
	private readonly options: NoteOption[];
	private readonly existingKeys: Set<string>;

	constructor(
		private readonly obsidianApp: App,
		input: HTMLInputElement,
		choice: ITemplateChoice,
		private readonly onSelect: (selection: TemplateNoteSelection) => void,
	) {
		super(obsidianApp, input);
		const { candidates, existingKeys } = buildDiscoveryCandidates(obsidianApp, choice);
		this.existingKeys = existingKeys;
		this.options = candidates.map((candidate) => ({
			item: candidate.item,
			label: candidate.renderPath?.split("/").at(-1)?.replace(/\.md$/i, "") ?? candidate.unresolvedTitle ?? candidate.title,
			detail: candidate.renderPath ?? "Unresolved link",
			search: candidate.display,
		}));
	}

	getSuggestions(query: string): NoteOption[] {
		const text = query.trim();
		if (!text) return this.options.slice(0, 100);
		const match = prepareFuzzySearch(text);
		const matches = this.options
			.map((option) => ({ option, match: match(option.search) }))
			.filter((entry) => entry.match !== null)
			.sort((a, b) => (b.match?.score ?? 0) - (a.match?.score ?? 0))
			.slice(0, 99)
			.map(({ option }) => option);
		const key = text.replace(/\.md$/i, "").toLowerCase();
		if (!this.existingKeys.has(key) && !this.options.some((option) => option.search.toLowerCase() === key)) {
			matches.push({ item: text, label: `Create new note: ${text}`, detail: "", search: text });
		}
		return matches;
	}

	renderSuggestion(option: NoteOption, el: HTMLElement): void {
		el.addClass("qa-onepage-file-suggestion");
		const text = el.createDiv({ cls: "qa-onepage-file-suggestion__text" });
		text.createDiv({ cls: "qa-onepage-file-suggestion__label", text: option.label });
		if (option.detail) text.createDiv({ cls: "qa-onepage-file-suggestion__path", text: option.detail });
	}

	selectSuggestion(option: NoteOption): void {
		try {
			const selection = selectionForDiscoveryCandidate(this.obsidianApp, option.item);
			this.inputEl.value = "";
			this.close();
			this.onSelect(selection);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not select this note.");
			this.inputEl.focus();
		}
	}
}
