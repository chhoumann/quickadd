import type { FuzzyMatch } from "obsidian";
import {
	Component,
	FuzzySuggestModal,
	MarkdownRenderer,
	prepareFuzzySearch,
} from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import { ChoiceExecutor } from "../../choiceExecutor";
import { MultiChoice } from "../../types/choices/MultiChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type QuickAdd from "../../main";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import { log } from "../../logger/logManager";
import { settingsStore } from "../../settingsStore";
import { flattenChoicesWithPath } from "../../utils/choiceUtils";

const backLabel = "← Back";

/**
 * Sentinel id for the synthetic back item. Back items are created fresh per
 * level and never persisted, so a constant non-uuid id cannot collide with a
 * real choice — and unlike name matching, it cannot be spoofed by a user
 * choice literally named "← Back". Detection must be stateless: pressing Back
 * restores a level that contains an ancestor's back item, whose identity no
 * other modal could have threaded along.
 */
export const BACK_CHOICE_ID = "quickadd:back";

/**
 * Applied to matches that fall entirely within the breadcrumb prefix, so a
 * query hitting a folder's name ranks the folder itself and genuine name
 * matches above the folder's entire subtree. Sized to outweigh same-name
 * fuzzy penalties (worst ~0.3) while staying above fragmented-match scores
 * (at most -1).
 */
const BREADCRUMB_ONLY_PENALTY = 0.5;

/**
 * Reduces basic inline markdown (emphasis, code, links) to its display text,
 * so breadcrumbs show ancestor names the way their own rows render them.
 */
export function stripInlineMarkdown(text: string): string {
	return text
		.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/\[\[([^\]]+)\]\]/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/(\*\*|__)(.+?)\1/g, "$2")
		// Single underscores are left alone: intraword `_` is not emphasis in
		// CommonMark, and names like my_file_name must survive intact.
		.replace(/\*(.+?)\*/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/~~(.+?)~~/g, "$1");
}

type NestedSearchCandidate = {
	choice: IChoice;
	/** Raw text the fuzzy search runs against: "Parent / Sub / Choice name". */
	text: string;
	/** Offset where the choice's own name starts within `text`. */
	nameOffset: number;
};

type ChoiceSuggesterOptions = {
	choiceExecutor?: IChoiceExecutor;
	placeholder?: string;
	placeholderStack?: Array<string | undefined>;
};
export default class ChoiceSuggester extends FuzzySuggestModal<IChoice> {
	private choiceExecutor: IChoiceExecutor;
	private placeholderStack: Array<string | undefined> = [];
	private currentPlaceholder?: string;
	private nestedSearchCandidates?: NestedSearchCandidate[];
	// Populated by getNestedSearchCandidates(); nested items can only reach
	// renderSuggestion through the nested-search branch of getSuggestions,
	// which builds the candidate cache (and thus this map) first.
	private breadcrumbById = new Map<string, string>();
	// Owns the lifecycle of the markdown render children created per suggestion,
	// so they are torn down when the suggester closes instead of leaking onto the
	// long-lived plugin instance.
	private readonly markdownComponent = new Component();

	public static Open(
		plugin: QuickAdd,
		choices: IChoice[],
		options?: ChoiceSuggesterOptions
	) {
		new ChoiceSuggester(plugin, choices, options).open();
	}

	constructor(
		private plugin: QuickAdd,
		private choices: IChoice[],
		options?: ChoiceSuggesterOptions
	) {
		super(plugin.app);
		// Initialize here (not as a field initializer) so the `plugin` parameter
		// property is already assigned; a field initializer runs before it.
		this.choiceExecutor =
			options?.choiceExecutor ?? new ChoiceExecutor(this.app, this.plugin);
		this.placeholderStack = options?.placeholderStack ?? [];
		this.currentPlaceholder = options?.placeholder?.trim() || undefined;
		if (this.currentPlaceholder) this.setPlaceholder(this.currentPlaceholder);
		this.markdownComponent.load();
	}

	onClose(): void {
		super.onClose();
		this.markdownComponent.unload();
	}

	getSuggestions(query: string): FuzzyMatch<IChoice>[] {
		const trimmed = query.trim();
		if (!trimmed || !settingsStore.getState().searchNestedChoices) {
			return super.getSuggestions(trimmed);
		}

		const fuzzy = prepareFuzzySearch(trimmed);
		const results: FuzzyMatch<IChoice>[] = [];
		for (const candidate of this.getNestedSearchCandidates()) {
			const match = fuzzy(candidate.text);
			if (!match) continue;
			if (
				candidate.nameOffset > 0 &&
				match.matches.length > 0 &&
				match.matches.every(([, end]) => end <= candidate.nameOffset)
			) {
				match.score -= BREADCRUMB_ONLY_PENALTY;
			}
			results.push({ item: candidate.choice, match });
		}
		results.sort((a, b) => b.match.score - a.match.score);
		return results;
	}

	private getNestedSearchCandidates(): NestedSearchCandidate[] {
		if (!this.nestedSearchCandidates) {
			// The back item wraps the entire previous level; flattening through
			// it would leak every ancestor into the results. It is dropped as a
			// candidate altogether — it is navigation, not content.
			const searchable = this.choices.filter(
				(choice) => choice.id !== BACK_CHOICE_ID
			);
			this.nestedSearchCandidates = flattenChoicesWithPath(searchable).map(
				({ choice, path }) => {
					const breadcrumb = path.slice(0, -1);
					if (breadcrumb.length > 0) {
						this.breadcrumbById.set(
							choice.id,
							breadcrumb.map(stripInlineMarkdown).join(" / ")
						);
					}
					const text = path.join(" / ");
					return {
						choice,
						text,
						nameOffset: text.length - choice.name.length,
					};
				}
			);
		}
		return this.nestedSearchCandidates;
	}

	renderSuggestion(item: FuzzyMatch<IChoice>, el: HTMLElement): void {
		el.empty();
		el.classList.remove("mod-complex");
		const breadcrumb = this.breadcrumbById.get(item.item.id);
		let nameEl: HTMLElement = el;
		if (breadcrumb) {
			el.classList.add("mod-complex");
			const content = el.createDiv({ cls: "suggestion-content" });
			nameEl = content.createDiv({ cls: "suggestion-title" });
			content.createDiv({ cls: "suggestion-note", text: breadcrumb });
		}
		void MarkdownRenderer.render(this.app, item.item.name, nameEl, "", this.markdownComponent)
			.catch((error) => {
				nameEl.textContent = item.item.name;
				log.logError(`Failed to render choice suggestion: ${error}`);
			});
		el.classList.add("quickadd-choice-suggestion");
		if (item.item.id === BACK_CHOICE_ID)
			el.classList.add("quickadd-choice-suggestion-back");
	}

	getItemText(item: IChoice): string {
		return item.name;
	}

	getItems(): IChoice[] {
		return this.choices;
	}

	onChooseItem(
		item: IChoice,
		evt: MouseEvent | KeyboardEvent
	): void {
		if (item.type === "Multi")
			this.onChooseMultiType(<IMultiChoice>item);
		else {
			void this.choiceExecutor.execute(item).catch((error) => {
				log.logError(`Failed to execute selected choice: ${error}`);
			});
		}
	}

	private onChooseMultiType(multi: IMultiChoice) {
		const choices = [...multi.choices];
		const isBack = multi.id === BACK_CHOICE_ID;

		if (!isBack) {
			const back = new MultiChoice(backLabel).addChoices(this.choices);
			back.id = BACK_CHOICE_ID;
			choices.push(back);
		}

		const nextPlaceholder = isBack
			? this.placeholderStack[this.placeholderStack.length - 1]
			: multi.placeholder?.trim() || multi.name;
		const nextStack = isBack
			? this.placeholderStack.slice(0, -1)
			: [...this.placeholderStack, this.currentPlaceholder];

		ChoiceSuggester.Open(this.plugin, choices, {
			choiceExecutor: this.choiceExecutor,
			placeholder: nextPlaceholder,
			placeholderStack: nextStack,
		});
	}
}
