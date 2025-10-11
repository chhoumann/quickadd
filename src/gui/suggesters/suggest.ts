import type { Instance as PopperInstance } from "@popperjs/core";
import { createPopper } from "@popperjs/core";
import type { App, ISuggestOwner } from "obsidian";
import { debounce, Scope } from "obsidian";
import { log } from "src/logger/logManager";
import { renderExactHighlight } from "./utils";

const wrapAround = (value: number, size: number): number => {
	return ((value % size) + size) % size;
};

class Suggest<T> {
	private owner: ISuggestOwner<T>;
	private values: T[];
	private suggestions: HTMLDivElement[];
	private selectedItem: number;
	private containerEl: HTMLElement;
	private isOpen = false;

	constructor(owner: ISuggestOwner<T>, containerEl: HTMLElement, scope: Scope) {
		this.owner = owner;
		this.containerEl = containerEl;

		containerEl.on(
			"click",
			".suggestion-item",
			this.onSuggestionClick.bind(this),
		);
		containerEl.on(
			"mousemove",
			".suggestion-item",
			this.onSuggestionMouseover.bind(this),
		);

		// Enhanced keyboard navigation
		scope.register([], "ArrowUp", (event) => {
			if (!event.isComposing && this.isOpen) {
				this.setSelectedItem(this.selectedItem - 1, true);
				return false;
			}
		});

		scope.register([], "ArrowDown", (event) => {
			if (!event.isComposing && this.isOpen) {
				this.setSelectedItem(this.selectedItem + 1, true);
				return false;
			}
		});

		scope.register([], "Enter", (event) => {
			if (!event.isComposing && this.isOpen) {
				this.useSelectedItem(event);
				return false;
			}
		});

		// Additional keyboard shortcuts
		scope.register([], "PageUp", (event) => {
			if (!event.isComposing && this.isOpen) {
				this.setSelectedItem(Math.max(0, this.selectedItem - 5), true);
				return false;
			}
		});

		scope.register([], "PageDown", (event) => {
			if (!event.isComposing && this.isOpen) {
				this.setSelectedItem(
					Math.min(this.suggestions.length - 1, this.selectedItem + 5),
					true,
				);
				return false;
			}
		});
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
		this.containerEl.empty();
		const suggestionEls: HTMLDivElement[] = [];

		values.forEach((value, index) => {
			const suggestionEl = this.containerEl.createDiv("suggestion-item");
			// Add accessibility attributes
			suggestionEl.setAttribute("role", "option");
			suggestionEl.setAttribute("aria-selected", "false");
			suggestionEl.setAttribute("id", `suggestion-${index}`);

			this.owner.renderSuggestion(value, suggestionEl);
			suggestionEls.push(suggestionEl);
		});

		this.values = values;
		this.suggestions = suggestionEls;
		this.setSelectedItem(0, false);
		this.isOpen = values.length > 0;
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
		prevSelectedSuggestion?.removeClass("is-selected");
		selectedSuggestion?.addClass("is-selected");

		// Update accessibility attributes
		prevSelectedSuggestion?.setAttribute("aria-selected", "false");
		selectedSuggestion?.setAttribute("aria-selected", "true");

		this.selectedItem = normalizedIndex;

		if (scrollIntoView) {
			selectedSuggestion.scrollIntoView(false);
		}
	}

	close() {
		this.isOpen = false;
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

	private popper: PopperInstance | null = null;
	private scope: Scope;
	private suggestEl: HTMLElement;
	private suggest: Suggest<T>;
	private currentRequestId = 0;
	private isOpen = false;
	private noResultsTimeout: number | null = null;
	private currentQuery = "";

	// Global listeners for close-on-anything-else
	private globalClickListener: (event: MouseEvent) => void;
	private globalWheelListener: (event: WheelEvent) => void;
	private globalResizeListener: () => void;
	private globalBlurListener: () => void;

	// Debounced input handler and bound event listeners
	private debouncedOnInputChanged: (event?: Event) => void;
	private inputEventListener: (event: Event) => void;
	private focusEventListener: () => void;

	// Highlighting function - can be overridden
	protected renderMatch: (el: HTMLElement, text: string, query: string) => void =
		renderExactHighlight;

	constructor(app: App, inputEl: HTMLInputElement | HTMLTextAreaElement) {
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

		byClass.set(classKey, this);

		this.app = app;
		this.inputEl = inputEl;
		this.scope = new Scope();

		this.suggestEl = createDiv("suggestion-container");
		const suggestion = this.suggestEl.createDiv("suggestion");

		// Add accessibility attributes to the suggestion container
		suggestion.setAttribute("role", "listbox");
		suggestion.setAttribute("aria-label", "Suggestions");

		this.suggest = new Suggest(this, suggestion, this.scope);

		this.scope.register([], "Escape", this.close.bind(this));

		// Shorter debounce for snappier UX
		this.debouncedOnInputChanged = debounce(this.onInputChanged.bind(this), 50);
		
		// Store bound event listeners for proper cleanup
		this.inputEventListener = (event: Event) => this.debouncedOnInputChanged(event);
		this.focusEventListener = () => this.debouncedOnInputChanged();

		this.inputEl.addEventListener("input", this.inputEventListener);
		this.inputEl.addEventListener("focus", this.focusEventListener);
		this.inputEl.addEventListener("blur", this.close.bind(this));

		// Set up accessibility relationship
		this.inputEl.setAttribute("aria-autocomplete", "list");
		this.inputEl.setAttribute("aria-expanded", "false");

		this.suggestEl.on(
			"mousedown",
			".suggestion-container",
			(event: MouseEvent) => {
				event.preventDefault();
			},
		);

		// Setup global listeners
		this.globalClickListener = this.onGlobalClick.bind(this);
		this.globalWheelListener = this.onGlobalWheel.bind(this);
		this.globalResizeListener = this.close.bind(this);
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

	async onInputChanged(event?: Event): Promise<void> {
		// Handle multi-select mode: keep suggestions open after selection
		if (event && (event as any).fromCompletion && (event as any).keepOpen) {
			const inputStr = this.inputEl.value;
			const requestId = ++this.currentRequestId;
			this.currentQuery = inputStr;

			try {
				const suggestions = await this.getSuggestions(inputStr);
				if (requestId === this.currentRequestId) {
					if (suggestions?.length) {
						this.suggest.setSuggestions(suggestions);
						// Already open, just update suggestions
						if (!this.isOpen) {
							this.open(this.app.dom.appContainerEl, this.inputEl);
						}
					} else {
						// No more items available to select, close the dropdown
						this.close();
					}
				}
			} catch (error) {
				log.logError(error as Error);
			}
			return;
		}

		// Ignore programmatic changes from completion selection
		if (event && (event as any).fromCompletion) {
			return;
		}

		const inputStr = this.inputEl.value;
		const requestId = ++this.currentRequestId;

		// Store current query for highlighting
		this.currentQuery = inputStr;

		try {
			const suggestions = await this.getSuggestions(inputStr);

			// Check if this is still the latest request
			if (requestId !== this.currentRequestId) {
				return; // Stale request, ignore
			}

			if (!suggestions || suggestions.length === 0) {
				// Show "No matches" briefly before closing
				if (this.isOpen) {
					this.showNoResultsAndClose();
				}
				return;
			}

			this.suggest.setSuggestions(suggestions);
			this.open(this.app.dom.appContainerEl, this.inputEl);
		} catch (error) {
			log.logError(error as Error);
			this.close();
		}
	}

	private showNoResultsAndClose(): void {
		// Clear any existing timeout
		if (this.noResultsTimeout) {
			window.clearTimeout(this.noResultsTimeout);
		}

		// Close immediately for now - could add "No matches" placeholder here
		this.close();
	}

	open(container: HTMLElement, inputEl: HTMLElement): void {
		// Always add listeners; if already open just update popper position
		if (!this.isOpen) {
			this.app.keymap.pushScope(this.scope);
		}
		this.isOpen = true;

		// Update accessibility attributes
		this.inputEl.setAttribute("aria-expanded", "true");

		container.appendChild(this.suggestEl);

		// Create Popper only when needed
		this.popper = createPopper(inputEl, this.suggestEl, {
			placement: "bottom-start",
			modifiers: [
				{
					name: "sameWidth",
					enabled: true,
					fn: ({ state, instance }) => {
						const targetWidth = `${state.rects.reference.width}px`;
						if (state.styles.popper.width === targetWidth) {
							return;
						}
						state.styles.popper.width = targetWidth;
						void instance.update();
					},
					phase: "beforeWrite",
					requires: ["computeStyles"],
				},
				{
					name: "flip",
					enabled: true,
				},
				{
					name: "preventOverflow",
					enabled: true,
				},
				{
					name: "offset",
					enabled: true,
					options: {
						offset: [0, 4],
					},
				},
			],
		});

		// Add global listeners (idempotent due to capture true)
		document.addEventListener("pointerdown", this.globalClickListener, true);
		document.addEventListener("wheel", this.globalWheelListener, true);
		window.addEventListener("resize", this.globalResizeListener);
		window.addEventListener("blur", this.globalBlurListener);
	}

	close(): void {
		if (!this.isOpen) return;

		this.app.keymap.popScope(this.scope);
		this.isOpen = false;

		// Update accessibility attributes
		this.inputEl.setAttribute("aria-expanded", "false");

		this.suggest.close();
		this.suggest.setSuggestions([]);

		// Destroy Popper instance
		if (this.popper) {
			this.popper.destroy();
			this.popper = null;
		}

		this.suggestEl.detach();

		// Clear no results timeout
		if (this.noResultsTimeout) {
			window.clearTimeout(this.noResultsTimeout);
			this.noResultsTimeout = null;
		}

		// Remove global listeners
		document.removeEventListener("pointerdown", this.globalClickListener, true);
		document.removeEventListener("wheel", this.globalWheelListener, true);
		window.removeEventListener("resize", this.globalResizeListener);
		window.removeEventListener("blur", this.globalBlurListener);

		const classKey = this.constructor.name;
		const byClass = instanceMap.get(this.inputEl);
		if (byClass) {
			byClass.delete(classKey);
			if (byClass.size === 0) {
				instanceMap.delete(this.inputEl);
			}
		}
	}

	destroy(): void {
		this.close();
		// Remove input listeners
		this.inputEl.removeEventListener("input", this.inputEventListener);
		this.inputEl.removeEventListener("focus", this.focusEventListener);
		this.inputEl.removeEventListener("blur", this.close.bind(this));

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

	// Helper method to get current query for highlighting
	protected getCurrentQuery(): string {
		return this.currentQuery;
	}



	// Abstract methods - now supports async
	abstract getSuggestions(inputStr: string): T[] | Promise<T[]>;
	abstract renderSuggestion(item: T, el: HTMLElement): void;
	abstract selectSuggestion(item: T, event: MouseEvent | KeyboardEvent): void;
}
