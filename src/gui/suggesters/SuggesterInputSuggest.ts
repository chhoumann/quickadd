import { setIcon, type App, type SearchMatches } from "obsidian";
import { rankMatches } from "./rankMatches";
import { TextInputSuggest } from "./suggest";
import {
	createRenderFallbackWarner,
	dispatchCompletion,
	normalizeForSearch,
	normalizeQuery,
	renderHighlightRanges,
} from "./utils";

const MAX_RESULTS = 200;

export interface SuggesterOption {
	key: string;
	value: string;
	label: string;
	isCustom?: boolean;
}

export interface SuggesterInputSuggestConfig {
	getOptions: () => readonly SuggesterOption[];
	onSelect: (option: SuggesterOption) => void;
	caseSensitive?: boolean;
	multiSelect?: boolean;
	allowCustomInput?: boolean;
	isSelected?: (option: SuggesterOption) => boolean;
	renderOption?: (value: string, el: HTMLElement, matches: SearchMatches) => void;
}

export function labelsMatch(a: string, b: string, caseSensitive: boolean): boolean {
	return caseSensitive ? a === b : normalizeForSearch(a) === normalizeForSearch(b);
}

export function customSuggesterOption(text: string): SuggesterOption {
	return { key: `custom:${text}`, value: text, label: text, isCustom: true };
}

export class SuggesterInputSuggest extends TextInputSuggest<SuggesterOption> {
	private readonly caseSensitive: boolean;
	private matchesByOption = new Map<SuggesterOption, SearchMatches>();
	private readonly warnRenderFailure = createRenderFallbackWarner(
		"Custom renderItem threw an error; falling back to default rendering",
	);
	private readonly keydownListener?: (event: KeyboardEvent) => void;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private readonly config: SuggesterInputSuggestConfig,
	) {
		super(app, inputEl);
		this.caseSensitive = config.caseSensitive ?? false;
		if (config.multiSelect) {
			inputEl.setAttribute("aria-multiselectable", "true");
			this.keydownListener = (event: KeyboardEvent) => {
				if (
					event.isComposing ||
					event.key !== "Enter" ||
					event.metaKey ||
					event.ctrlKey ||
					event.altKey ||
					event.shiftKey ||
					this.isPopupOpen()
				) return;
				const [first] = this.inputEl.value.trim() ? this.getSuggestions(this.inputEl.value) : [];
				if (!first) return;
				event.preventDefault();
				this.selectSuggestion(first);
			};
			inputEl.addEventListener("keydown", this.keydownListener);
		}
	}

	override destroy(): void {
		if (this.keydownListener) {
			this.inputEl.removeEventListener("keydown", this.keydownListener);
		}
		super.destroy();
	}

	private isSelected(option: SuggesterOption): boolean {
		return this.config.isSelected?.(option) ?? false;
	}

	getSuggestions(query: string): SuggesterOption[] {
		const text = normalizeQuery(query);
		const options = this.config.getOptions();
		const available = this.config.multiSelect
			? options.filter((option) => !this.isSelected(option))
			: [...options];
		const ranked = rankMatches(text, available, (option) => option.label, {
			limit: MAX_RESULTS,
			caseSensitive: this.caseSensitive,
		});
		this.matchesByOption = new Map(ranked.map(({ item, matches }) => [item, matches]));
		const matches = ranked.map(({ item }) => item);
		const custom = this.customOption(text.trim(), options);
		return custom ? [...matches, custom] : matches;
	}

	private customOption(text: string, options: readonly SuggesterOption[]): SuggesterOption | undefined {
		if (!text || !this.config.multiSelect || this.config.allowCustomInput === false) return undefined;
		if (options.some((option) => labelsMatch(option.label, text, this.caseSensitive))) return undefined;
		const custom = customSuggesterOption(text);
		return this.isSelected(custom) ? undefined : custom;
	}

	renderSuggestion(option: SuggesterOption, el: HTMLElement): void {
		if (option.isCustom) {
			el.addClass("mod-complex");
			el.createDiv({ cls: "suggestion-content", text: `Add “${option.label}”` });
			setIcon(el.createDiv({ cls: "suggestion-aux" }).createSpan({ cls: "suggestion-flair" }), "plus");
			return;
		}
		const matches = this.matchesByOption.get(option) ?? [];
		if (this.config.renderOption) {
			try {
				this.config.renderOption(option.value, el, matches);
				return;
			} catch (error) {
				this.warnRenderFailure(error);
				el.replaceChildren();
			}
		}
		renderHighlightRanges(el, option.label, matches);
	}

	selectSuggestion(option: SuggesterOption): void {
		if (!this.config.multiSelect) {
			this.inputEl.value = option.label;
			this.config.onSelect(option);
			dispatchCompletion(this.inputEl);
			this.close();
			return;
		}

		this.config.onSelect(option);
		this.inputEl.value = "";
		if (this.config.getOptions().some((candidate) => !this.isSelected(candidate))) {
			this.inputEl.focus();
			dispatchCompletion(this.inputEl, true);
		} else {
			this.close();
			this.inputEl.focus();
		}
	}
}
