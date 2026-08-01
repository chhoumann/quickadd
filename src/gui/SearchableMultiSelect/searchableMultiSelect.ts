export interface SearchableMultiSelectItem<T> {
	/** Selection identity. Rows with the same key share selected state. */
	key: string;
	value: T;
	label: string;
	/** Extra text used for filtering without adding it to the visible label. */
	searchText?: string;
}

export interface SearchableMultiSelectOptions<T> {
	items: readonly SearchableMultiSelectItem<T>[];
	isSelected: (item: SearchableMultiSelectItem<T>) => boolean;
	onToggle: (
		item: SearchableMultiSelectItem<T>,
		selected: boolean,
	) => void;
	getSelectedCount?: () => number;
	searchPlaceholder?: string;
	emptyText?: string;
}

interface IndexedItem<T> {
	item: SearchableMultiSelectItem<T>;
	index: number;
	searchableText: string;
}

interface RenderedRow<T> {
	item: SearchableMultiSelectItem<T>;
	input: HTMLInputElement;
}

const MAX_VISIBLE_OPTIONS = 200;
let pickerId = 0;

function normalizeSearchText(value: string): string {
	return value.normalize("NFKD").toLowerCase();
}

/**
 * Reusable, DOM-only searchable checkbox list. Prompt-specific result ordering,
 * custom values, submission, and cancellation remain with the owning modal.
 */
export default class SearchableMultiSelect<T> {
	private readonly rootEl: HTMLDivElement;
	private readonly searchInputEl: HTMLInputElement;
	private readonly summaryEl: HTMLDivElement;
	private readonly listEl: HTMLDivElement;
	private readonly instanceId = ++pickerId;
	private indexedItems: IndexedItem<T>[] = [];
	private renderedRows: RenderedRow<T>[] = [];
	private query = "";

	constructor(
		containerEl: HTMLElement,
		private readonly options: SearchableMultiSelectOptions<T>,
	) {
		this.rootEl = document.createElement("div");
		this.rootEl.className = "qa-searchable-multi-select";

		const searchContainer = document.createElement("div");
		searchContainer.className =
			"search-input-container qa-searchable-multi-select__search-container";
		this.searchInputEl = document.createElement("input");
		this.searchInputEl.className = "qa-searchable-multi-select__search";
		this.searchInputEl.type = "search";
		this.searchInputEl.name = `qa-multi-select-search-${this.instanceId}`;
		this.searchInputEl.placeholder =
			options.searchPlaceholder ?? "Search options...";
		this.searchInputEl.setAttribute("aria-label", this.searchInputEl.placeholder);
		this.searchInputEl.setAttribute("autocomplete", "off");
		this.searchInputEl.setAttribute("spellcheck", "false");
		searchContainer.appendChild(this.searchInputEl);

		this.summaryEl = document.createElement("div");
		this.summaryEl.className = "qa-searchable-multi-select__summary";
		this.summaryEl.setAttribute("aria-live", "polite");

		this.listEl = document.createElement("div");
		this.listEl.className = "qa-searchable-multi-select__list";
		this.listEl.setAttribute("role", "group");
		this.listEl.setAttribute("aria-label", "Options");

		this.rootEl.append(searchContainer, this.summaryEl, this.listEl);
		containerEl.appendChild(this.rootEl);

		this.searchInputEl.addEventListener("input", () => {
			this.query = this.searchInputEl.value;
			this.renderList();
		});
		this.searchInputEl.addEventListener("keydown", (event) => {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				this.renderedRows[0]?.input.focus();
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				this.renderedRows.at(-1)?.input.focus();
				return;
			}
			if (event.key === "Escape" && this.query) {
				event.preventDefault();
				event.stopPropagation();
				this.query = "";
				this.searchInputEl.value = "";
				this.renderList();
			}
		});

		this.setItems(options.items);
	}

	setItems(items: readonly SearchableMultiSelectItem<T>[]): void {
		this.indexedItems = items.map((item, index) => ({
			item,
			index,
			searchableText: normalizeSearchText(
				`${item.label} ${item.searchText ?? ""}`,
			),
		}));
		this.searchInputEl.disabled = items.length === 0;
		this.renderList();
	}

	focusSearchOnOpen(): void {
		if (document.body.classList.contains("is-mobile")) return;
		this.searchInputEl.focus();
	}

	refreshSelection(): void {
		for (const { item, input } of this.renderedRows) {
			input.checked = this.options.isSelected(item);
			input.closest("label")?.classList.toggle("is-selected", input.checked);
		}
		this.updateSummary();
	}

	private getMatchingItems(): IndexedItem<T>[] {
		const tokens = normalizeSearchText(this.query.trim())
			.split(/\s+/)
			.filter(Boolean);
		if (tokens.length === 0) return this.indexedItems;
		return this.indexedItems.filter(({ searchableText }) =>
			tokens.every((token) => searchableText.includes(token)),
		);
	}

	private getVisibleItems(matches: IndexedItem<T>[]): IndexedItem<T>[] {
		if (matches.length <= MAX_VISIBLE_OPTIONS) return matches;
		const selected: IndexedItem<T>[] = [];
		const unselected: IndexedItem<T>[] = [];
		for (const indexed of matches) {
			(this.options.isSelected(indexed.item) ? selected : unselected).push(
				indexed,
			);
		}
		return [...selected, ...unselected].slice(0, MAX_VISIBLE_OPTIONS);
	}

	private renderList(): void {
		this.listEl.replaceChildren();
		this.renderedRows = [];
		const matches = this.getMatchingItems();
		const visible = this.getVisibleItems(matches);

		if (visible.length === 0) {
			const empty = document.createElement("div");
			empty.className = "qa-searchable-multi-select__empty";
			empty.setAttribute("role", "status");
			empty.textContent = this.indexedItems.length
				? `No options match “${this.query.trim()}”`
				: (this.options.emptyText ?? "No options available");
			this.listEl.appendChild(empty);
		}

		for (const indexed of visible) {
			this.renderRow(indexed);
		}

		if (matches.length > visible.length) {
			const limit = document.createElement("div");
			limit.className = "qa-searchable-multi-select__limit";
			limit.setAttribute("role", "status");
			limit.textContent = `Showing ${visible.length} of ${matches.length} options. Refine your search to see the rest.`;
			this.listEl.appendChild(limit);
		}

		this.updateSummary(matches.length);
	}

	private renderRow(indexed: IndexedItem<T>): void {
		const { item, index } = indexed;
		const row = document.createElement("label");
		row.className = "qa-searchable-multi-select__option";
		const input = document.createElement("input");
		input.type = "checkbox";
		input.name = `qa-multi-select-${this.instanceId}`;
		input.id = `qa-multi-select-${this.instanceId}-${index}`;
		input.checked = this.options.isSelected(item);
		const label = document.createElement("span");
		label.className = "qa-searchable-multi-select__option-label";
		label.textContent = item.label;
		row.htmlFor = input.id;
		row.classList.toggle("is-selected", input.checked);
		row.append(label, input);

		input.addEventListener("change", () => {
			this.options.onToggle(item, input.checked);
			this.refreshSelection();
		});
		input.addEventListener("keydown", (event) => {
			this.handleOptionKeydown(event, input);
		});

		this.listEl.appendChild(row);
		this.renderedRows.push({ item, input });
	}

	private handleOptionKeydown(
		event: KeyboardEvent,
		input: HTMLInputElement,
	): void {
		const index = this.renderedRows.findIndex((row) => row.input === input);
		if (event.key === "ArrowDown") {
			event.preventDefault();
			this.renderedRows[index + 1]?.input.focus();
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			if (index === 0) this.searchInputEl.focus();
			else this.renderedRows[index - 1]?.input.focus();
			return;
		}
		if (event.key === "Home") {
			event.preventDefault();
			this.renderedRows[0]?.input.focus();
			return;
		}
		if (event.key === "End") {
			event.preventDefault();
			this.renderedRows.at(-1)?.input.focus();
			return;
		}
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			input.checked = !input.checked;
			input.dispatchEvent(new Event("change", { bubbles: true }));
			return;
		}
		if (event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey) {
			event.preventDefault();
			this.searchInputEl.focus();
		}
	}

	private updateSummary(matchCount = this.getMatchingItems().length): void {
		const selectedCount =
			this.options.getSelectedCount?.() ??
			new Set(
				this.indexedItems
					.filter(({ item }) => this.options.isSelected(item))
					.map(({ item }) => item.key),
			).size;
		const selectedLabel = `${selectedCount} selected`;
		if (!this.query.trim()) {
			this.summaryEl.textContent = `${selectedLabel} · ${this.indexedItems.length} options`;
			return;
		}
		this.summaryEl.textContent = `${selectedLabel} · ${matchCount} matches`;
	}
}
