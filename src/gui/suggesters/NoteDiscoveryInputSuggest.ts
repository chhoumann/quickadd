import { Notice, prepareFuzzySearch, type App, type Scope } from "obsidian";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { existingNoteActionVerb } from "src/template/fileExistsPolicy";
import {
	buildDiscoveryCandidates,
	createTemplateNoteSelection,
	normalizedKey,
	selectionForDiscoveryCandidate,
	type TemplateNoteSelection,
} from "src/utils/templateNoteDiscovery";
import { TextInputSuggest } from "./suggest";

type NoteOption = {
	item: string;
	exactKeys: string[];
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
		parentScope?: Scope,
	) {
		const { candidates, existingKeys } = buildDiscoveryCandidates(obsidianApp, choice);
		super(obsidianApp, input, parentScope);
		this.existingKeys = existingKeys;
		const action = existingNoteActionVerb(choice.existingNoteAction);
		this.options = candidates.map((candidate) => ({
			item: candidate.item,
			exactKeys: candidate.exactKeys,
			label: candidate.renderPath
				? `${action === "Open" ? "" : `${action}: `}${candidate.renderPath.split("/").at(-1)?.replace(/\.md$/i, "")}`
				: candidate.unresolvedTitle ?? candidate.title,
			detail: candidate.renderPath ?? "Unresolved link",
			search: candidate.display,
		}));
	}

	getSuggestions(query: string): NoteOption[] {
		const text = query.trim();
		if (!text) return this.options.slice(0, 100);
		const key = normalizedKey(text);
		const match = prepareFuzzySearch(text);
		const matches = this.options
			.map((option) => ({ option, match: match(option.search) }))
			.filter((entry) => entry.match !== null)
			.sort((a, b) => Number(b.option.exactKeys.includes(key)) - Number(a.option.exactKeys.includes(key)) ||
				(b.match?.score ?? 0) - (a.match?.score ?? 0))
			.slice(0, 99)
			.map(({ option }) => option);
		if (!this.existingKeys.has(key) && !this.options.some((option) => option.exactKeys.includes(key))) {
			matches.unshift({ item: text, exactKeys: [key], label: `Create new note: ${text}`, detail: "", search: text });
		}
		return matches;
	}

	resolveInput(text: string): TemplateNoteSelection {
		const key = normalizedKey(text);
		const exact = this.options.find((option) => option.exactKeys.includes(key));
		return exact ? selectionForDiscoveryCandidate(this.obsidianApp, exact.item) : createTemplateNoteSelection(text);
	}

	renderSuggestion(option: NoteOption, el: HTMLElement): void {
		el.addClass("qa-onepage-file-suggestion");
		const text = el.createDiv({ cls: "qa-onepage-file-suggestion__text" });
		text.createDiv({ cls: "qa-onepage-file-suggestion__label", text: option.label });
		if (option.detail) text.createDiv({ cls: "qa-onepage-file-suggestion__path", text: option.detail });
	}

	selectSuggestion(option: NoteOption): void {
		try {
			const selection = this.options.includes(option)
				? selectionForDiscoveryCandidate(this.obsidianApp, option.item)
				: createTemplateNoteSelection(option.item);
			this.inputEl.value = "";
			this.close();
			this.onSelect(selection);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : "Could not select this note.");
			this.inputEl.focus();
		}
	}
}
