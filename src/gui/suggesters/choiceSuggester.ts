import type { FuzzyMatch } from "obsidian";
import {
	Component,
	FuzzySuggestModal,
	MarkdownRenderer,
	Notice,
	prepareFuzzySearch,
	setIcon,
} from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import { ChoiceExecutor } from "../../choiceExecutor";
import { MultiChoice } from "../../types/choices/MultiChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type QuickAdd from "../../main";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import { log } from "../../logger/logManager";
import { settingsStore } from "../../settingsStore";
import { childChoicesOf, flattenChoicesWithPath } from "../../utils/choiceUtils";
import type { FrontmatterPropertyTarget } from "../../utils/frontmatterPropertyLinks";
import { getFocusedPropertyTarget } from "../../utils/frontmatterPropertyLinks";
import type { QuickAddTriggerContext } from "../../types/QuickAddTriggerContext";
import {
	hasConfiguredTemplateFolders,
	runTemplateFromFolder,
} from "../../engine/runTemplateFromFolder";
import { resolveChoiceIcon } from "../../utils/choiceUtils";
import { createOwnedElement } from "../../utils/activeWindow";

const backLabel = "← Back";

/**
 * Search hint for the launcher's input. Every Obsidian picker labels its own;
 * QuickAdd's rendered completely blank, which reads as an unfinished surface
 * (issue #1540). Nested levels override this with the folder's name or its
 * custom placeholder.
 */
const DEFAULT_PLACEHOLDER = "Select a choice";

/**
 * Shared wording for "you opened a folder that has nothing in it", so the
 * picker's drill-down and the command/URI execute path (choiceExecutor) say the
 * same thing.
 */
export function emptyFolderNoticeText(folderName: string): string {
	return `Folder "${folderName}" is empty.`;
}

/**
 * Trailing marker on a folder row the picker cannot drill into. Same word the
 * settings tree already uses for this exact state ("Empty — add a choice or drag
 * one here.", ChoiceList.svelte), so the two surfaces name it the same way.
 */
export const EMPTY_FOLDER_FLAIR = "Empty";

/**
 * Sentinel id for the synthetic "New note from template" launcher row (#1023).
 * Like {@link BACK_CHOICE_ID}, it is navigation/action — never a real choice —
 * so it is dispatched explicitly and excluded from nested search. The constant
 * prefix cannot collide with a real uuid-keyed choice.
 */
export const RUN_TEMPLATE_FROM_FOLDER_ID = "quickadd:run-template-from-folder";
const runTemplateFromFolderLabel = "New note from template…";

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
 * A folder row the picker cannot drill into (#1554): a Multi choice with no
 * children. Deliberately NOT recursive — a folder containing only empty folders
 * still has rows to show, so calling it empty would be false; its children carry
 * the marker one level down. `?.length` rather than `.length === 0` tolerates a
 * data.json whose `choices` is missing or not an array, which the loader
 * preserves rather than heals.
 *
 * The Back row is excluded: it is navigation, and the level it wraps is
 * legitimately allowed to be empty.
 */
export function isEmptyFolderChoice(choice: IChoice): boolean {
	return (
		choice.type === "Multi" &&
		choice.id !== BACK_CHOICE_ID &&
		childChoicesOf(choice).length === 0
	);
}

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
	focusedProperty?: FrontmatterPropertyTarget | null;
	/**
	 * Trigger-time editor context (the active note) captured when the launcher
	 * opened, threaded through nested Multi levels so a leaf choice's
	 * {{...|default-from:active}} still reads the original trigger note (issue
	 * #1429). Absent at the top level → captured live in the constructor.
	 */
	triggerContext?: QuickAddTriggerContext | null;
	placeholder?: string;
	placeholderStack?: Array<string | undefined>;
	/**
	 * Inject the synthetic "New note from template" row at the top of this
	 * level. Set only by the top-level launcher (Run QuickAdd / ribbon); never
	 * by nested Multi navigation, so the row stays top-level only.
	 */
	includeTemplateFolderRow?: boolean;
};

/**
 * Whether the synthetic "New note from template" row would actually appear in
 * the top-level launcher. Exported so the launcher entry point can tell whether
 * the picker has anything at all to show before opening it (issue #1540).
 */
export function shouldShowTemplateFolderRow(plugin: QuickAdd): boolean {
	const rowPosition = plugin.settings.templateFolderLauncherRow ?? "bottom";
	return rowPosition !== "off" && hasConfiguredTemplateFolders(plugin);
}

function createTemplateFolderRow(): IChoice {
	return {
		id: RUN_TEMPLATE_FROM_FOLDER_ID,
		name: runTemplateFromFolderLabel,
		type: "Template",
		command: false,
	};
}
export default class ChoiceSuggester extends FuzzySuggestModal<IChoice> {
	private choiceExecutor: IChoiceExecutor;
	private focusedProperty: FrontmatterPropertyTarget | null = null;
	private triggerContext: QuickAddTriggerContext | null = null;
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
		this.focusedProperty =
			options && "focusedProperty" in options
				? options.focusedProperty ?? null
				: getFocusedPropertyTarget(this.app);
		// Capture the trigger-time active note when the launcher opens (top level),
		// or reuse the one threaded down from a parent Multi level. getActiveFile()
		// reads the active markdown leaf, which the suggester overlay doesn't change.
		this.triggerContext =
			options && "triggerContext" in options
				? options.triggerContext ?? null
				: { activeFile: this.app.workspace.getActiveFile() };
		this.placeholderStack = options?.placeholderStack ?? [];
		// `currentPlaceholder` is what a nested level pushes onto the stack so Back
		// can restore it, so it must hold the effective placeholder (including the
		// default), not just an explicitly-passed one.
		this.currentPlaceholder = options?.placeholder?.trim() || DEFAULT_PLACEHOLDER;
		this.setPlaceholder(this.currentPlaceholder);
		this.markdownComponent.load();

		// Insert the synthetic "New note from template" row only at the top level
		// (includeTemplateFolderRow), and only when a template folder is actually
		// configured (otherwise the action would just send the user to settings).
		// Position is user-controlled: "bottom" (default) keeps it out of the
		// first-Enter slot, "top" makes it first, "off" hides it. Settings are read
		// inside this guard so nested-level opens (no settings on the test plugin)
		// never touch them.
		if (options?.includeTemplateFolderRow) {
			const rowPosition =
				this.plugin.settings.templateFolderLauncherRow ?? "bottom";
			if (shouldShowTemplateFolderRow(this.plugin)) {
				const row = createTemplateFolderRow();
				this.choices =
					rowPosition === "top"
						? [row, ...this.choices]
						: [...this.choices, row];
			}
		}
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
			// it would leak every ancestor into the results. It and the synthetic
			// template-folder row are dropped as candidates — they are
			// navigation/action, not content.
			const searchable = this.choices.filter(
				(choice) =>
					choice.id !== BACK_CHOICE_ID &&
					choice.id !== RUN_TEMPLATE_FROM_FOLDER_ID
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

	/**
	 * Refuses to open an empty folder (#1554), which the row already announces
	 * with its "Empty" marker. This is the only seam where the activation can be
	 * refused without ejecting the user: `SuggestModal.selectSuggestion` closes
	 * the modal *before* `onChooseItem` runs, so returning above `super` is what
	 * keeps the picker open with its typed query, scroll position and selection
	 * intact. Both input paths land here — the chooser routes clicks and Enter
	 * through the owner's `selectSuggestion`.
	 */
	selectSuggestion(
		value: FuzzyMatch<IChoice>,
		evt: MouseEvent | KeyboardEvent
	): void {
		if (isEmptyFolderChoice(value.item)) {
			// OS key auto-repeat: the chooser's Enter binding filters composition but
			// not `repeat`, and nothing closes the modal any more, so a held Enter
			// would stack one identical notice per repeat. Property read rather than
			// `instanceof KeyboardEvent` — a popout window is a separate realm.
			if ("repeat" in evt && evt.repeat) return;
			new Notice(emptyFolderNoticeText(value.item.name));
			// A trusted mousedown on `.suggestion-item` — a non-focusable div with no
			// focusable ancestor, since neither `.modal` nor `.modal-container` carries
			// a tabindex — moves focus to <body>. Obsidian never has to handle that
			// because every other activation closes the modal; this is the first path
			// that keeps it open, so without this the input goes dead while the picker
			// still looks alive (arrow keys and Escape keep working, typing does not).
			// No-op on the keyboard path, and on mobile it keeps the keyboard up.
			this.inputEl.focus();
			return;
		}

		super.selectSuggestion(value, evt);
	}

	renderSuggestion(item: FuzzyMatch<IChoice>, el: HTMLElement): void {
		el.empty();
		el.classList.remove("mod-complex");
		const breadcrumb = this.breadcrumbById.get(item.item.id);

		const row = el.createDiv({ cls: "quickadd-choice-suggestion-content" });
		this.renderChoiceIcon(item.item, row);

		let nameEl: HTMLElement;
		if (breadcrumb) {
			el.classList.add("mod-complex");
			const content = row.createDiv({
				cls: "suggestion-content quickadd-choice-suggestion-text",
			});
			nameEl = content.createDiv({ cls: "suggestion-title" });
			content.createDiv({ cls: "suggestion-note", text: breadcrumb });
		} else {
			nameEl = row.createDiv({
				cls: "quickadd-choice-suggestion-title quickadd-choice-suggestion-text",
			});
		}
		void MarkdownRenderer.render(this.app, item.item.name, nameEl, "", this.markdownComponent)
			.catch((error) => {
				nameEl.textContent = item.item.name;
				log.logError(`Failed to render choice suggestion: ${error}`);
			});
		el.classList.add("quickadd-choice-suggestion");
		if (item.item.id === BACK_CHOICE_ID)
			el.classList.add("quickadd-choice-suggestion-back");
		if (item.item.id === RUN_TEMPLATE_FROM_FOLDER_ID)
			el.classList.add("quickadd-choice-suggestion-run-template");

		// Say the folder is a dead end before the click, not after it (#1554). The
		// row keeps its place in the list — hiding it would make a configured folder
		// vanish, which is a worse, unexplained dead end. `el.empty()` above clears
		// children but never attributes, so the marker is cleared explicitly for
		// rows Obsidian recycles (matching the defensive `mod-complex` reset).
		const isEmptyFolder = isEmptyFolderChoice(item.item);
		el.classList.toggle("quickadd-choice-suggestion-empty", isEmptyFolder);
		if (isEmptyFolder) {
			// Not operable, but still focusable and still able to explain itself —
			// which is exactly what aria-disabled means, unlike HTML `disabled`.
			el.setAttribute("aria-disabled", "true");
			const flair = createOwnedElement(row, "span");
			flair.classList.add("quickadd-choice-suggestion-empty-flair");
			flair.textContent = EMPTY_FOLDER_FLAIR;
			row.appendChild(flair);
		} else {
			el.removeAttribute("aria-disabled");
		}
	}

	private renderChoiceIcon(choice: IChoice, parent: HTMLElement): void {
		const iconId = this.getChoiceSuggestionIcon(choice);
		if (!iconId) return;

		const iconEl = createOwnedElement(parent, "span");
		iconEl.classList.add("quickadd-choice-icon");
		iconEl.setAttribute("aria-hidden", "true");
		parent.appendChild(iconEl);
		setIcon(iconEl, iconId);
	}

	private getChoiceSuggestionIcon(choice: IChoice): string | undefined {
		if (choice.id === BACK_CHOICE_ID) return undefined;
		if (choice.id === RUN_TEMPLATE_FROM_FOLDER_ID) return "file-plus";
		return resolveChoiceIcon(choice);
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
		// Sentinel action row — must be handled before the type dispatch, since it
		// carries no templatePath and would fail the Template engine's invariant.
		if (item.id === RUN_TEMPLATE_FROM_FOLDER_ID) {
			void runTemplateFromFolder(this.app, this.plugin, {
				choiceExecutor: this.choiceExecutor,
			}).catch((error) => {
				log.logError(`Failed to run template from folder: ${error}`);
			});
			return;
		}

		if (item.type === "Multi")
			this.onChooseMultiType(<IMultiChoice>item);
		else {
			// Route through executeWithFocusedProperty whenever it exists so the
			// captured focusedProperty AND triggerContext (issue #1429) are both
			// re-injected for the leaf run — the suggester cleared the executor's
			// live context when the outer Multi execute() returned. Falls back to
			// execute() only for stub executors without the method.
			const execute = this.choiceExecutor.executeWithFocusedProperty
				? this.choiceExecutor.executeWithFocusedProperty(
						item,
						this.focusedProperty,
						this.triggerContext,
					)
				: this.choiceExecutor.execute(item);
			void execute.catch((error) => {
				log.logError(`Failed to execute selected choice: ${error}`);
			});
		}
	}

	private onChooseMultiType(multi: IMultiChoice) {
		const isBack = multi.id === BACK_CHOICE_ID;

		// Unreachable from the picker: selectSuggestion refuses empty folders above
		// `super`, so the modal never closes and this never dispatches. Kept as a
		// backstop for programmatic onChooseItem calls (it is public API on
		// FuzzySuggestModal) so any future regression degrades to "notice, nothing
		// happens" instead of opening a level whose only row is "← Back". It is also
		// what makes the spread below safe on a folder with no `choices` array.
		//
		// #1550's close-and-reopen is gone with the ejection it worked around: it
		// discarded the typed query, the scroll position and the selection.
		if (!isBack && isEmptyFolderChoice(multi)) {
			new Notice(emptyFolderNoticeText(multi.name));
			return;
		}

		const choices = [...childChoicesOf(multi)];

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
			focusedProperty: this.focusedProperty,
			triggerContext: this.triggerContext,
			placeholder: nextPlaceholder,
			placeholderStack: nextStack,
		});
	}
}
