import { FuzzySuggestModal, type App, type FuzzyMatch } from "obsidian";
import { promptCancelled } from "src/errors/UserCancelError";
import {
	rankFieldLinkOptions,
	storedFieldLinkTarget,
	type FieldLinkOptions,
	type FieldLinkSuggestion,
} from "src/utils/fieldLinkValues";
import { renderFieldLinkSuggestion } from "../suggesters/renderFieldLinkSuggestion";

const LIMIT = 100;

/**
 * The `{{FIELD:<name>|link}}` picker: the property's values when it opens,
 * other notes once you type, and `Link to [[...]]` for a name no note has.
 * Resolves the picked link.
 */
export class FieldLinkSuggester extends FuzzySuggestModal<FieldLinkSuggestion> {
	readonly promise: Promise<string>;
	private resolvePromise!: (link: string) => void;
	private rejectPromise!: (reason: unknown) => void;
	private settled = false;

	static Suggest(
		app: App,
		links: FieldLinkOptions,
		options: { placeholder: string; onPick?: (target: string) => void },
	): Promise<string> {
		return new FieldLinkSuggester(app, links, options.placeholder, options.onPick).promise;
	}

	constructor(
		app: App,
		private readonly links: FieldLinkOptions,
		placeholder: string,
		private readonly onPick?: (target: string) => void,
	) {
		super(app);
		// `qa-suggester` is a stable hook for user CSS snippets (see SuggesterModal).
		this.modalEl.addClass("qa-suggester", "qa-field-link-suggester");
		this.limit = LIMIT;
		if (links.existingCount === 0) {
			this.emptyStateText = "No existing values yet. Type to search notes or create a link.";
		}
		this.promise = new Promise<string>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});
		this.setPlaceholder(placeholder);
		this.inputEl.addEventListener("keydown", (event) => this.completeSelectedNameOnTab(event));
		this.open();
	}

	private completeSelectedNameOnTab(event: KeyboardEvent): void {
		if (event.key !== "Tab" || !("chooser" in this)) return;
		const { values, selectedItem } = this.chooser as {
			values?: FuzzyMatch<FieldLinkSuggestion>[];
			selectedItem: number;
		};
		const item = values?.[selectedItem]?.item;
		if (!item) return;
		event.preventDefault();
		this.inputEl.value = item.kind === "option" ? item.option.display : item.display;
		this.inputEl.dispatchEvent(new Event("input"));
	}

	getItems(): FieldLinkSuggestion[] {
		return [];
	}

	getItemText(item: FieldLinkSuggestion): string {
		return item.kind === "option" ? item.option.display : item.display;
	}

	getSuggestions(query: string): FuzzyMatch<FieldLinkSuggestion>[] {
		return rankFieldLinkOptions(this.links, query, { limit: LIMIT, scope: "all", includeNewRow: true })
			.map((item) => ({ item, match: { score: 0, matches: [] } }));
	}

	renderSuggestion({ item }: FuzzyMatch<FieldLinkSuggestion>, el: HTMLElement): void {
		renderFieldLinkSuggestion(item, el);
	}

	selectSuggestion(value: FuzzyMatch<FieldLinkSuggestion>, event: MouseEvent | KeyboardEvent): void {
		this.settled = true;
		super.selectSuggestion(value, event);
	}

	onChooseItem(item: FieldLinkSuggestion): void {
		this.settled = true;
		this.onPick?.(item.kind === "option" ? storedFieldLinkTarget(item.option) : item.link);
		this.resolvePromise(item.kind === "option" ? this.links.linkForOption(item.option) : item.link);
	}

	onClose(): void {
		super.onClose();
		if (!this.settled) this.rejectPromise(promptCancelled());
	}
}
