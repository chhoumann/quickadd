import type { FuzzyMatch } from "obsidian";
import {
	Component,
	FuzzySuggestModal,
	Notice,
	prepareFuzzySearch,
	setIcon,
} from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import { MultiChoice } from "../../types/choices/MultiChoice";
import type IMultiChoice from "../../types/choices/IMultiChoice";
import type { AppProvider, PluginManifestInfo, SettingsProvider, TemplateFileSource } from "../../types/pluginContext";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import type { ChoiceChain } from "../../engine/choiceChain";
import { createRenderFallbackWarner } from "./utils";
import { isCancellationError, reportUnlessCancelled, toError } from "../../utils/errorUtils";
import { promptCancelled } from "../../errors/UserCancelError";
import { settingsStore } from "../../settingsStore";
import {
	childChoicesOf,
	flattenChoicesWithPath,
	hasUnreadableChildren,
} from "../../utils/choiceUtils";
import { emptyFolderNoticeText } from "../../utils/choiceNotices";
import type { FrontmatterPropertyTarget } from "../../utils/frontmatterPropertyLinks";
import { getFocusedPropertyTarget } from "../../utils/frontmatterPropertyLinks";
import type { QuickAddTriggerContext } from "../../types/QuickAddTriggerContext";
import {
	hasConfiguredTemplateFolders,
	runTemplateFromFolder,
} from "../../engine/runTemplateFromFolder";
import { resolveChoiceIcon } from "../../utils/choiceUtils";
import { createOwnedElement } from "../../utils/activeWindow";
import { renderChoiceName } from "../choiceList/renderChoiceName";

const backLabel = "← Back";

/**
 * Search hint for the launcher's input. Nested levels override it with the
 * folder's name or its custom placeholder.
 */
const DEFAULT_PLACEHOLDER = "Select a choice";

/** Marker on a folder row the picker cannot drill into, worded like the settings tree's empty state. */
const EMPTY_FOLDER_FLAIR = "Empty";

/**
 * For a folder whose contents could not be read, as opposed to absent; the
 * settings list says they are still in data.json.
 */
const UNREADABLE_FOLDER_FLAIR = "Unreadable";

/** The trailing marker for a folder row that cannot be opened, or "" for one that can. */
export function folderFlairFor(choice: IChoice): string {
	if (!isEmptyFolderChoice(choice)) return "";
	return hasUnreadableChildren(choice)
		? UNREADABLE_FOLDER_FLAIR
		: EMPTY_FOLDER_FLAIR;
}

/**
 * Sentinel id for the synthetic "New note from template" launcher row. Like
 * {@link BACK_CHOICE_ID} it is an action, never a real choice, so it is
 * dispatched explicitly and excluded from nested search.
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
 * A Multi with no children. Not recursive: a folder of empty folders still has
 * rows to show. `?.length` tolerates a missing or non-array `choices`. The Back
 * row is excluded.
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

/** What the picker reads from the plugin, including for its "New note from template" row. */
type ChoiceSuggesterPlugin = AppProvider & SettingsProvider & TemplateFileSource & PluginManifestInfo;

type ChoiceSuggesterOptions = {
	/** Runs the picked choice. */
	choiceExecutor: IChoiceExecutor;
	focusedProperty?: FrontmatterPropertyTarget | null;
	/**
	 * Active note captured when the launcher opened, threaded through nested
	 * levels so a leaf's `|default-from:active` reads the trigger note.
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
	/**
	 * Called once when the picker session ends: no argument on success, the
	 * leaf's error on failure, a cancellation on dismissal. Only the terminal
	 * action settles it. Set by ChoiceExecutor's Multi path, which awaits it;
	 * absent for the fire-and-forget launcher.
	 */
	completion?: (error?: Error) => void;
	/**
	 * Chain of the folder run that opened this picker, so the picked choice runs
	 * inside it. Set with `completion` by ChoiceExecutor's Multi path; absent for
	 * the top-level launcher.
	 */
	ancestry?: ChoiceChain;
	/**
	 * Pick mode, for the API's pickChoice: a picked Template, Capture or Macro is
	 * handed here and nothing runs. Folders still open, and typing searches nested
	 * choices whatever Search nested choices says, since the caller wants any leaf.
	 * Threaded through folder levels like `completion`, which still settles a
	 * dismissal.
	 */
	onPick?: (choice: IChoice) => void;
};

/**
 * Whether the "New note from template" row would appear in the top-level
 * launcher, so the launcher can tell whether the picker has anything to show.
 */
export function shouldShowTemplateFolderRow(plugin: SettingsProvider): boolean {
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
	private readonly completion?: ChoiceSuggesterOptions["completion"];
	private readonly ancestry?: ChoiceChain;
	private readonly onPick?: ChoiceSuggesterOptions["onPick"];
	/**
	 * Set the moment an activation is accepted (selectSuggestion, BEFORE the
	 * modal closes), so onClose can tell a dismissal from a pick:
	 * SuggestModal.selectSuggestion closes the modal before onChooseItem runs,
	 * which makes onClose alone ambiguous. A drill-down/Back activation hands
	 * the completion to the next level, so it must not be treated as a
	 * dismissal either - the flag covers both.
	 */
	private selectionDispatched = false;
	private nestedSearchCandidates?: NestedSearchCandidate[];
	// Populated by getNestedSearchCandidates(); nested items can only reach
	// renderSuggestion through the nested-search branch of getSuggestions,
	// which builds the candidate cache (and thus this map) first.
	private breadcrumbById = new Map<string, string>();
	// Owns the lifecycle of the markdown render children created per suggestion,
	// so they are torn down when the suggester closes instead of leaking onto the
	// long-lived plugin instance.
	private readonly markdownComponent = new Component();
	private readonly warnRenderFailure = createRenderFallbackWarner(
		"Could not render a choice name as Markdown; showing it as plain text",
	);

	public static Open(
		plugin: ChoiceSuggesterPlugin,
		choices: IChoice[],
		options: ChoiceSuggesterOptions
	) {
		new ChoiceSuggester(plugin, choices, options).open();
	}

	constructor(
		private plugin: ChoiceSuggesterPlugin,
		private choices: IChoice[],
		options: ChoiceSuggesterOptions
	) {
		super(plugin.app);
		// `qa-choice-suggester` is a stable hook for user CSS snippets (see SuggesterModal).
		this.modalEl.addClass("qa-choice-suggester");
		this.choiceExecutor = options.choiceExecutor;
		this.focusedProperty =
			"focusedProperty" in options
				? options.focusedProperty ?? null
				: getFocusedPropertyTarget(this.app);
		// Capture the trigger-time active note when the launcher opens (top level),
		// or reuse the one threaded down from a parent Multi level. getActiveFile()
		// reads the active markdown leaf, which the suggester overlay doesn't change.
		this.triggerContext =
			"triggerContext" in options
				? options.triggerContext ?? null
				: { activeFile: this.app.workspace.getActiveFile() };
		this.placeholderStack = options.placeholderStack ?? [];
		this.completion = options.completion;
		this.ancestry = options.ancestry;
		this.onPick = options.onPick;
		// `currentPlaceholder` is what a nested level pushes onto the stack so Back
		// can restore it, so it must hold the effective placeholder (including the
		// default), not just an explicitly-passed one.
		this.currentPlaceholder = options.placeholder?.trim() || DEFAULT_PLACEHOLDER;
		this.setPlaceholder(this.currentPlaceholder);
		this.markdownComponent.load();

		// Only at the top level, and only with a template folder configured.
		// Settings are read inside this guard so nested levels never touch them.
		if (options.includeTemplateFolderRow) {
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
		// Closed without any accepted activation = the user dismissed the picker
		// (Escape, scrim click). The awaiting run is cancelled like any other
		// dismissed prompt; without this it would hang forever on the completion.
		if (this.completion && !this.selectionDispatched) {
			this.completion(promptCancelled());
		}
	}

	getSuggestions(query: string): FuzzyMatch<IChoice>[] {
		const trimmed = query.trim();
		const searchNested = this.onPick !== undefined || settingsStore.getState().searchNestedChoices;
		if (!trimmed || !searchNested) {
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
	 * Refuses to open an empty folder. `SuggestModal.selectSuggestion` closes the
	 * modal before `onChooseItem` runs, so this is the only seam that can refuse
	 * without discarding the query, scroll and selection. Clicks and Enter both
	 * land here.
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
			new Notice(emptyFolderNoticeText(value.item));
			// A trusted mousedown on a non-focusable `.suggestion-item` moves focus
			// to <body>. Obsidian never handles that because every other activation
			// closes the modal, so refocus or typing goes dead.
			this.inputEl.focus();
			return;
		}

		// Every accepted activation - leaf, folder drill-down, Back, the template
		// row - passes here before the modal closes; see selectionDispatched.
		this.selectionDispatched = true;
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
		void renderChoiceName(item.item.name, nameEl, this.markdownComponent, this.app)
			.catch((error) => {
				nameEl.textContent = item.item.name;
				// renderSuggestion re-runs per row per keystroke, so a failing
				// renderer warns once rather than raising a notice per row.
				this.warnRenderFailure(error);
			});
		el.classList.add("quickadd-choice-suggestion");
		if (item.item.id === BACK_CHOICE_ID)
			el.classList.add("quickadd-choice-suggestion-back");
		if (item.item.id === RUN_TEMPLATE_FROM_FOLDER_ID)
			el.classList.add("quickadd-choice-suggestion-run-template");

		// Mark the dead end before the click. `el.empty()` clears children but not
		// attributes, so recycled rows are reset explicitly.
		const flairText = folderFlairFor(item.item);
		const isEmptyFolder = flairText !== "";
		el.classList.toggle("quickadd-choice-suggestion-empty", isEmptyFolder);
		if (isEmptyFolder) {
			// Not operable, but still focusable and still able to explain itself —
			// which is exactly what aria-disabled means, unlike HTML `disabled`.
			el.setAttribute("aria-disabled", "true");
			const flair = createOwnedElement(row, "span");
			flair.classList.add("quickadd-choice-suggestion-empty-flair");
			flair.textContent = flairText;
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

	/**
	 * Settles the awaiting run when a terminal action's promise does, passing the
	 * same error instance so report-once keeps it to one notice. One place for
	 * both terminal branches, since a stranded completion hangs the run.
	 */
	private settleCompletion(promise: Promise<void>, errorContext: string): void {
		void promise.then(
			() => this.completion?.(),
			(error: unknown) => {
				const failure = typeof error === "string" && isCancellationError(error)
					? promptCancelled()
					: toError(error);
				reportUnlessCancelled(failure, errorContext);
				this.completion?.(failure);
			},
		);
	}

	onChooseItem(
		item: IChoice,
		evt: MouseEvent | KeyboardEvent
	): void {
		// Sentinel action row — must be handled before the type dispatch, since it
		// carries no templatePath and would fail the Template engine's invariant.
		if (item.id === RUN_TEMPLATE_FROM_FOLDER_ID) {
			// The row is launcher-only today (no completion there), but settle it
			// anyway: a stranded completion would silently hang an awaiting run.
			this.settleCompletion(
				runTemplateFromFolder(this.app, this.plugin, {
					choiceExecutor: this.choiceExecutor,
				}),
				"Could not run a template from that folder",
			);
			return;
		}

		if (item.type === "Multi")
			this.onChooseMultiType(<IMultiChoice>item);
		else if (this.onPick)
			this.onPick(item);
		else {
			// executeWithFocusedProperty re-injects the captured property and trigger
			// context: the launcher's leaf is its own depth-0 run, while on the Multi
			// path the outer execute() is still pending.
			const enclosingCallerDay = this.choiceExecutor.callerDay;
			if ("shiftKey" in evt && evt.shiftKey) {
				this.choiceExecutor.callerDay = "pick";
			}
			const run = this.choiceExecutor.executeWithFocusedProperty
				? this.choiceExecutor.executeWithFocusedProperty(
						item,
						this.focusedProperty,
						this.triggerContext,
						this.ancestry,
					)
				: this.choiceExecutor.execute(item, this.ancestry);
			// Shift picks a day for this choice, not for the Macro steps after it.
			const execute = run.finally(() => {
				this.choiceExecutor.callerDay = enclosingCallerDay;
			});
			this.settleCompletion(execute, `Could not run "${item.name}"`);
		}
	}

	private onChooseMultiType(multi: IMultiChoice) {
		const isBack = multi.id === BACK_CHOICE_ID;

		// Backstop for programmatic onChooseItem calls; selectSuggestion already
		// refuses empty folders. Also makes the spread below safe on a folder
		// without a `choices` array.
		if (!isBack && isEmptyFolderChoice(multi)) {
			new Notice(emptyFolderNoticeText(multi));
			// The modal already closed (this is post-dispatch), so nothing else can
			// settle an awaiting run: resolve it as "finished, nothing ran".
			this.completion?.();
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
			// Hand the awaiting run down through every drill-down/Back level; only
			// the terminal action settles it.
			completion: this.completion,
			ancestry: this.ancestry,
			onPick: this.onPick,
		});
	}
}
