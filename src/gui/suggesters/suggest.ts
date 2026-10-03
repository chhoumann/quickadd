import type { App, ISuggestOwner } from "obsidian";
import { debounce, Scope, type Debouncer } from "obsidian";
import { log } from "src/logger/logManager";
import { createOwnedElement, getOwnerDocument, getOwnerWindow } from "src/utils/activeWindow";
import { renderExactHighlight } from "./utils";

const wrapAround = (value: number, size: number): number => {
	return ((value % size) + size) % size;
};

// Gap between the input and the list.
const LIST_GAP_PX = 4;
// The narrowest the list gets beside a narrow input, such as the Macro builder's
// script field on a phone, so a name wraps between words, not between letters.
const MIN_LIST_WIDTH_PX = 300;

/**
 * Whether the list should open above its input when it fits there. QuickAdd
 * prompts end in an action bar (`.qa-prompt-actions`: Submit, Cancel, Peek)
 * below their inputs (pinned to the bottom of the one-page form), and the list
 * is layered above the modal, so a list that reaches the bar takes the click
 * aimed at Submit.
 */
function prefersAbove(inputEl: HTMLElement, input: DOMRect, listHeight: number): boolean {
	const actionsEl = inputEl.closest(".modal")?.querySelector(".qa-prompt-actions");
	if (!actionsEl) return false;
	const actions = actionsEl.getBoundingClientRect();
	const actionsBelowInput = actions.height > 0 && actions.top >= input.bottom;
	const reachesActions = input.bottom + LIST_GAP_PX + listHeight > actions.top;
	return actionsBelowInput && reachesActions;
}

/**
 * Place the list against its input, exactly as wide as the input (also past
 * the 500px cap Obsidian puts on `.suggestion-container`; the text prompt's
 * input is wider), but at least `MIN_LIST_WIDTH_PX` or the viewport's width.
 * It opens below the input, and above it when the visible viewport has room
 * there and either `prefersAbove` or there is no room below (above the
 * on-screen keyboard on a phone). When neither side holds the whole list, it
 * takes the roomier side, shortened to fit. Horizontally it stays inside the
 * viewport.
 */
function placeList(inputEl: HTMLElement, listEl: HTMLElement): void {
	const input = inputEl.getBoundingClientRect();
	const doc = inputEl.ownerDocument;
	const viewport = doc.defaultView?.visualViewport ?? {
		offsetLeft: 0,
		offsetTop: 0,
		width: doc.documentElement.clientWidth,
		height: doc.documentElement.clientHeight,
	};
	const width = Math.max(input.width, Math.min(MIN_LIST_WIDTH_PX, viewport.width));
	listEl.style.maxWidth = "none";
	listEl.style.maxHeight = "";
	listEl.style.width = `${width}px`;
	// Measured at 0,0, the list's rect is its containing block's origin, so the
	// viewport positions below hold whatever element it is positioned against.
	listEl.style.left = "0px";
	listEl.style.top = "0px";
	const origin = listEl.getBoundingClientRect();

	// On a phone the on-screen keyboard covers the bottom of the screen without
	// always shrinking the visual viewport (Android leaves it full height).
	// Obsidian lays its own UI out above `100vh - var(--keyboard-height)`.
	const keyboardHeight =
		parseFloat(getComputedStyle(doc.documentElement).getPropertyValue("--keyboard-height")) || 0;
	const visibleBottom = Math.min(
		viewport.offsetTop + viewport.height,
		doc.documentElement.clientHeight - keyboardHeight,
	);
	// The top of a phone's screen is the status bar. On a phone, a settings page
	// scrolls under the settings header, which holds the back and close buttons.
	const safeAreaTop =
		parseFloat(getComputedStyle(doc.body).getPropertyValue("--safe-area-inset-top")) || 0;
	const settingsHeader = inputEl.closest(".modal.mod-settings")?.querySelector(".modal-header");
	const visibleTop = Math.max(
		viewport.offsetTop + safeAreaTop,
		settingsHeader?.getBoundingClientRect().bottom ?? 0,
	);

	const roomBelow = visibleBottom - input.bottom - LIST_GAP_PX;
	const roomAbove = input.top - LIST_GAP_PX - visibleTop;
	const fitsBelow = origin.height <= roomBelow;
	const fitsAbove = origin.height <= roomAbove;
	const placeAbove = fitsAbove
		? !fitsBelow || prefersAbove(inputEl, input, origin.height)
		: !fitsBelow && roomAbove > roomBelow;
	const height = Math.min(origin.height, placeAbove ? roomAbove : roomBelow);
	if (height < origin.height) listEl.style.maxHeight = `${height}px`;
	const top = placeAbove ? input.top - LIST_GAP_PX - height : input.bottom + LIST_GAP_PX;
	const left = Math.max(
		viewport.offsetLeft,
		Math.min(input.left, viewport.offsetLeft + viewport.width - width),
	);
	listEl.style.left = `${left - origin.left}px`;
	listEl.style.top = `${top - origin.top}px`;
}

/**
 * Let a path in a plain row wrap after its slashes rather than mid-name. `/` is
 * not a line-break opportunity, so without this a long path either runs past
 * the list's edge or (with `overflow-wrap: anywhere`) breaks at whatever letter
 * reaches it. `<wbr>` leaves the row's text unchanged. Only text directly in
 * the row or its highlight marks is touched: structured rows (a name and a
 * path in their own spans) keep their own wrapping, such as an ellipsized
 * path, which Chromium would let `<wbr>` break.
 */
function allowBreaksAfterSlashes(row: HTMLElement): void {
	const texts = Array.from(row.childNodes)
		.flatMap((node) => (node.nodeName === "MARK" ? Array.from(node.childNodes) : [node]))
		.filter((node): node is Text =>
			node.nodeType === Node.TEXT_NODE && Boolean(node.nodeValue?.includes("/")),
		);
	for (const text of texts) {
		const parts = (text.nodeValue ?? "").split(/(?<=\/)/);
		text.replaceWith(
			...parts.flatMap((part) =>
				part.endsWith("/") ? [part, createOwnedElement(row, "wbr")] : [part],
			),
		);
	}
}

let textInputSuggestSeq = 0;

type CompletionInputEvent = Event & {
	fromCompletion?: boolean;
	keepOpen?: boolean;
};

class Suggest<T> {
	private owner: ISuggestOwner<T>;
	private values: T[];
	private suggestions: HTMLDivElement[];
	private selectedItem: number;
	private containerEl: HTMLElement;
	private isOpen = false;
	private clickListener: (event: MouseEvent) => void;
	private mousemoveListener: (event: MouseEvent) => void;
	private optionIdPrefix: string;
	private onActiveOptionChange: (optionId: string | null) => void;

	constructor(
		owner: ISuggestOwner<T>,
		containerEl: HTMLElement,
		scope: Scope,
		optionIdPrefix: string,
		onActiveOptionChange: (optionId: string | null) => void,
	) {
		this.owner = owner;
		this.containerEl = containerEl;
		this.optionIdPrefix = optionIdPrefix;
		this.onActiveOptionChange = onActiveOptionChange;

		this.clickListener = (event: MouseEvent) => {
			const item = this.findSuggestionItem(event.target);
			if (item) this.onSuggestionClick(event, item);
		};
		this.mousemoveListener = (event: MouseEvent) => {
			const item = this.findSuggestionItem(event.target);
			if (item) this.onSuggestionMouseover(event, item);
		};
		containerEl.addEventListener("click", this.clickListener);
		containerEl.addEventListener("mousemove", this.mousemoveListener);

		const navigation: Record<string, () => number> = {
			ArrowUp: () => this.selectedItem - 1,
			ArrowDown: () => this.selectedItem + 1,
			PageUp: () => Math.max(0, this.selectedItem - 5),
			PageDown: () => Math.min(this.suggestions.length - 1, this.selectedItem + 5),
		};
		for (const [key, nextIndex] of Object.entries(navigation)) {
			scope.register([], key, (event) => {
				if (!event.isComposing && this.isOpen) {
					this.setSelectedItem(nextIndex(), true);
					return false;
				}
			});
		}
	}

	private findSuggestionItem(target: EventTarget | null): HTMLDivElement | null {
		const ownerWindow = this.containerEl.ownerDocument.defaultView;
		if (!ownerWindow || !(target instanceof ownerWindow.Element)) {
			return null;
		}
		const item = target.closest<HTMLDivElement>(".suggestion-item");
		return item && this.containerEl.contains(item) ? item : null;
	}

	onSuggestionClick(event: MouseEvent, el: HTMLDivElement): void {
		event.preventDefault();

		const item = this.suggestions.indexOf(el);
		this.setSelectedItem(item, false);
		this.useSelectedItem(event);
	}

	onSuggestionMouseover(_event: MouseEvent, el: HTMLDivElement): void {
		const item = this.suggestions.indexOf(el);
		this.setSelectedItem(item, false);
	}

	setSuggestions(values: T[]) {
		this.containerEl.replaceChildren();
		const suggestionEls: HTMLDivElement[] = [];

		values.forEach((value, index) => {
			const suggestionEl = this.containerEl.createDiv({ cls: "suggestion-item" });
			suggestionEl.setAttribute("role", "option");
			suggestionEl.setAttribute("aria-selected", "false");
			suggestionEl.setAttribute("id", `${this.optionIdPrefix}-option-${index}`);

			this.owner.renderSuggestion(value, suggestionEl);
			allowBreaksAfterSlashes(suggestionEl);
			suggestionEls.push(suggestionEl);
		});

		this.values = values;
		this.suggestions = suggestionEls;
		if (values.length === 0) {
			this.isOpen = false;
			this.onActiveOptionChange(null);
			return;
		}
		this.setSelectedItem(0, false);
		this.isOpen = true;
	}

	useSelectedItem(event: MouseEvent | KeyboardEvent) {
		const currentValue = this.values[this.selectedItem];
		if (currentValue) {
			this.owner.selectSuggestion(currentValue, event);
		}
	}

	setSelectedItem(selectedIndex: number, scrollIntoView: boolean) {
		if (!this.suggestions?.length) return;

		const normalizedIndex = wrapAround(selectedIndex, this.suggestions.length);
		const prevSelectedSuggestion = this.suggestions[this.selectedItem];
		const selectedSuggestion = this.suggestions[normalizedIndex];

		// Update visual selection
		prevSelectedSuggestion?.classList.remove("is-selected");
		selectedSuggestion?.classList.add("is-selected");

		prevSelectedSuggestion?.setAttribute("aria-selected", "false");
		selectedSuggestion?.setAttribute("aria-selected", "true");
		this.onActiveOptionChange(selectedSuggestion?.id ?? null);

		this.selectedItem = normalizedIndex;

		if (scrollIntoView) {
			selectedSuggestion.scrollIntoView(false);
		}
	}

	close() {
		this.isOpen = false;
		this.onActiveOptionChange(null);
	}

	getIsOpen(): boolean {
		return this.isOpen;
	}
}

// Extend App interface to avoid any casts
declare module "obsidian" {
	interface App {
		dom: {
			appContainerEl: HTMLElement;
		};
		keymap: {
			pushScope(scope: Scope): void;
			popScope(scope: Scope): void;
		};
	}
}

// Instance reuse to prevent duplicate popups. We allow one instance *per class* per input element so
// different suggesters (e.g., file + format) can coexist, while still preventing duplicates of the same type.
const instanceMap = new WeakMap<
	HTMLInputElement | HTMLTextAreaElement,
	Map<string, TextInputSuggest<unknown>>
>();

export abstract class TextInputSuggest<T> implements ISuggestOwner<T> {
	protected app: App;
	protected inputEl: HTMLInputElement | HTMLTextAreaElement;

	private scope: Scope;
	private suggestEl: HTMLElement;
	private suggest: Suggest<T>;
	private listboxId: string;
	private currentRequestId = 0;
	private isOpen = false;
	private destroyed = false;
	private currentQuery = "";
	// The input text the shown list was built for.
	private listQuery: string | null = null;

	// Global listeners for close-on-anything-else
	private globalClickListener: (event: MouseEvent) => void;
	private globalWheelListener: (event: WheelEvent) => void;
	private globalScrollListener: (event: Event) => void;
	private globalResizeListener: () => void;
	private globalKeyboardListener: () => void;
	private globalBlurListener: () => void;
	private inputBlurListener: () => void;

	// Debounced input handler and bound event listeners
	private debouncedOnInputChanged: Debouncer<[event?: Event], Promise<void>>;
	private inputEventListener: (event: Event) => void;
	private focusEventListener: () => void;

	// Highlighting function - can be overridden
	protected renderMatch: (el: HTMLElement, text: string, query: string) => void =
		renderExactHighlight;

	constructor(app: App, inputEl: HTMLInputElement | HTMLTextAreaElement, parentScope?: Scope) {
		// Manage per-input map of suggesters keyed by their class name
		const classKey = this.constructor.name;
		let byClass = instanceMap.get(inputEl);
		if (!byClass) {
			byClass = new Map();
			instanceMap.set(inputEl, byClass);
		}

		const existingOfSameClass = byClass.get(classKey);
		if (existingOfSameClass) {
			existingOfSameClass.destroy();
		}

		// destroy() above removes the replaced instance from instanceMap, and if it
		// was this input's last entry it deletes the whole per-input map - detaching
		// our local `byClass`. Re-attach before registering ourselves so this
		// instance stays discoverable for the next same-class dedup; otherwise a
		// later suggester misses it and never tears it down, leaking its input
		// listeners and spawning duplicate popups.
		instanceMap.set(inputEl, byClass);
		byClass.set(classKey, this);

		this.app = app;
		this.inputEl = inputEl;
		this.scope = new Scope(parentScope);

		this.suggestEl = this.inputEl.ownerDocument.win.createDiv();
		this.suggestEl.classList.add("suggestion-container", "qa-text-input-suggest");
		const suggestion = this.suggestEl.createDiv({ cls: "suggestion" });

		this.listboxId = `qa-suggest-listbox-${++textInputSuggestSeq}`;
		suggestion.id = this.listboxId;
		suggestion.setAttribute("role", "listbox");
		suggestion.setAttribute("aria-label", "Suggestions");

		this.suggest = new Suggest(
			this,
			suggestion,
			this.scope,
			this.listboxId,
			(optionId) => this.setActiveDescendant(optionId),
		);

		this.scope.register([], "Escape", this.close.bind(this));
		this.scope.register([], "Enter", (event) => {
			if (event.isComposing || !this.suggest.getIsOpen()) return;
			void this.useSelectedItem(event);
			return false;
		});

		// Shorter debounce for snappier UX
		this.debouncedOnInputChanged = debounce(this.onInputChanged.bind(this), 50);
		
		// Store bound event listeners for proper cleanup
		this.inputEventListener = (event: Event) => this.debouncedOnInputChanged(event);
		this.focusEventListener = () => this.debouncedOnInputChanged();
		this.inputBlurListener = this.close.bind(this);

		this.inputEl.addEventListener("input", this.inputEventListener);
		this.inputEl.addEventListener("focus", this.focusEventListener);
		this.inputEl.addEventListener("blur", this.inputBlurListener);

		this.inputEl.setAttribute("role", "combobox");
		this.inputEl.setAttribute("aria-autocomplete", "list");
		this.inputEl.setAttribute("aria-expanded", "false");
		this.inputEl.setAttribute("aria-controls", this.listboxId);
		this.inputEl.setAttribute("aria-haspopup", "listbox");

		this.suggestEl.addEventListener("mousedown", (event: MouseEvent) => {
			event.preventDefault();
		});

		// Setup global listeners
		this.globalClickListener = this.onGlobalClick.bind(this);
		this.globalWheelListener = this.onGlobalWheel.bind(this);
		// Keep the list on its input when a scroll moves the input (a scrolled
		// form); scrolling the list itself moves nothing.
		this.globalScrollListener = (event: Event) => {
			if (!this.suggestEl.contains(event.target as Node)) this.reposition();
		};
		this.globalResizeListener = this.close.bind(this);
		// A list opened as its field took focus was placed before the keyboard
		// came up; the keyboard does not always resize or scroll anything.
		this.globalKeyboardListener = this.reposition.bind(this);
		this.globalBlurListener = this.close.bind(this);
	}

	private onGlobalClick(event: MouseEvent): void {
		if (!this.isOpen) return;

		const target = event.target as Node;
		if (!this.suggestEl.contains(target) && !this.inputEl.contains(target)) {
			this.close();
		}
	}

	private onGlobalWheel(event: WheelEvent): void {
		if (!this.isOpen) return;

		const target = event.target as Node;
		if (!this.suggestEl.contains(target)) {
			this.close();
		}
	}

	async onInputChanged(event?: CompletionInputEvent): Promise<void> {
		// A pending debounced call can fire after destroy() removed the input
		// listeners; bail so a destroyed instance never re-opens.
		if (this.destroyed || this.inputEl.closest("[hidden]")) return;
		// The handler is debounced, so focus may have moved on since the focus or
		// input event fired; a popup must never open under an unfocused input.
		if (this.inputEl.ownerDocument.activeElement !== this.inputEl) return;
		const keepOpen = Boolean(event?.fromCompletion && event.keepOpen);
		if (event?.fromCompletion && !keepOpen) return;

		const inputStr = this.inputEl.value;
		const requestId = ++this.currentRequestId;
		this.currentQuery = inputStr;
		try {
			const suggestions = await this.getSuggestions(inputStr);
			if (requestId !== this.currentRequestId) return;
			if (!suggestions?.length) {
				if (keepOpen || this.isOpen) this.close();
				return;
			}
			this.suggest.setSuggestions(suggestions);
			this.listQuery = inputStr;
			if (keepOpen && this.isOpen) {
				// A multi-select pick refreshes the open list in place, but the list's
				// height and the input's position (a new chip row) can both change.
				this.reposition();
			} else {
				this.open(this.app.dom.appContainerEl, this.inputEl);
			}
		} catch (error) {
			log.logError(error as Error);
			if (!keepOpen) this.close();
		}
	}

	/**
	 * Enter picks from the list, but the list follows the text a debounce
	 * later. A fast typist's Enter can land in between: build the list for the
	 * text first, so Enter never picks a row the text no longer matches.
	 */
	private async useSelectedItem(event: KeyboardEvent): Promise<void> {
		if (this.inputEl.value !== this.listQuery) {
			this.debouncedOnInputChanged.cancel();
			await this.onInputChanged();
			if (this.inputEl.value !== this.listQuery || !this.suggest.getIsOpen()) return;
		}
		this.suggest.useSelectedItem(event);
	}

	open(container: HTMLElement, inputEl: HTMLElement): void {
		// An async getSuggestions() may resolve after destroy() and reach open();
		// refuse to re-open a destroyed instance (would spawn an orphaned popup).
		if (this.destroyed || inputEl.closest("[hidden]")) return;
		// open() also runs on every keystroke while the list is open, to refresh
		// it (onInputChanged). The scope and global listeners are added once,
		// when the list opens, and removed together in close().
		const opening = !this.isOpen;
		if (opening) {
			this.app.keymap.pushScope(this.scope);
		}
		this.isOpen = true;
		this.inputEl.setAttribute("aria-expanded", "true");
		this.inputEl.setAttribute("aria-controls", this.listboxId);

		const inputDocument = getOwnerDocument(inputEl);
		const containerDocument = getOwnerDocument(container);
		const ownerCompatibleContainer =
			containerDocument === inputDocument ? container : inputDocument.body;
		ownerCompatibleContainer.appendChild(this.suggestEl);
		this.reposition();
		if (!opening) return;

		const activeWindow = getOwnerWindow(inputEl);
		inputDocument.addEventListener("pointerdown", this.globalClickListener, true);
		inputDocument.addEventListener("wheel", this.globalWheelListener, true);
		inputDocument.addEventListener("scroll", this.globalScrollListener, true);
		activeWindow.addEventListener("resize", this.globalResizeListener);
		activeWindow.addEventListener("keyboardDidShow", this.globalKeyboardListener);
		activeWindow.addEventListener("blur", this.globalBlurListener);
	}

	/**
	 * Re-place the open list after its contents or its input moved. The side
	 * is re-decided each time because the list's height changes as the user
	 * types.
	 */
	private reposition(): void {
		placeList(this.inputEl, this.suggestEl);
	}

	close(): void {
		this.currentRequestId++;
		if (!this.isOpen) return;

		this.app.keymap.popScope(this.scope);
		this.isOpen = false;
		this.inputEl.setAttribute("aria-expanded", "false");
		this.setActiveDescendant(null);

		this.suggest.close();
		this.suggest.setSuggestions([]);

		this.suggestEl.remove();

		// Remove global listeners
		const activeDocument = getOwnerDocument(this.inputEl);
		const activeWindow = getOwnerWindow(this.inputEl);
		activeDocument.removeEventListener("pointerdown", this.globalClickListener, true);
		activeDocument.removeEventListener("wheel", this.globalWheelListener, true);
		activeDocument.removeEventListener("scroll", this.globalScrollListener, true);
		activeWindow.removeEventListener("resize", this.globalResizeListener);
		activeWindow.removeEventListener("keyboardDidShow", this.globalKeyboardListener);
		activeWindow.removeEventListener("blur", this.globalBlurListener);

		// Intentionally keep this instance registered in instanceMap. close()
		// only hides the dropdown; the input/focus/blur listeners stay attached
		// so typing can re-open it. Unregistering here (while leaving those
		// listeners live) would orphan the instance: a later same-class suggester
		// on this input would miss the dedup in the constructor and never
		// destroy() us, leaking our input listeners and spawning duplicate
		// popups. Deregistration belongs to destroy().
	}

	destroy(): void {
		// Mark dead first so any in-flight async getSuggestions() or pending
		// debounced onInputChanged() that resolves after this point can't re-open.
		this.destroyed = true;
		this.close();
		// Remove input listeners
		this.inputEl.removeEventListener("input", this.inputEventListener);
		this.inputEl.removeEventListener("focus", this.focusEventListener);
		this.inputEl.removeEventListener("blur", this.inputBlurListener);

		// Remove from instance map
		const classKey = this.constructor.name;
		const byClass = instanceMap.get(this.inputEl);
		if (byClass) {
			byClass.delete(classKey);
			if (byClass.size === 0) {
				instanceMap.delete(this.inputEl);
			}
		}
	}

	private setActiveDescendant(optionId: string | null): void {
		if (optionId) {
			this.inputEl.setAttribute("aria-activedescendant", optionId);
			return;
		}
		this.inputEl.removeAttribute("aria-activedescendant");
	}

	// Helper method to get current query for highlighting
	protected getCurrentQuery(): string {
		return this.currentQuery;
	}



	// Abstract methods - now supports async
	abstract getSuggestions(inputStr: string): T[] | Promise<T[]>;
	abstract renderSuggestion(item: T, el: HTMLElement): void;
	abstract selectSuggestion(item: T, event: MouseEvent | KeyboardEvent): void;
}
