import type { App } from "obsidian";
import { ButtonComponent, Modal } from "obsidian";
import { promptCancelled } from "../../errors/UserCancelError";
import SearchableMultiSelect from "../SearchableMultiSelect/searchableMultiSelect";

export default class GenericCheckboxPrompt extends Modal {
	private resolvePromise: (value: string[]) => void;
	private rejectPromise: (reason?: unknown) => void;
	public promise: Promise<string[]>;
	private resolved: boolean;
	private _selectedItems: string[];
	private picker: SearchableMultiSelect<string>;

	public static Open(
		app: App,
		items: string[],
		selectedItems?: string[],
		header?: string
	) {
		const newSuggester = new GenericCheckboxPrompt(
			app,
			items,
			selectedItems,
			header
		);
		return newSuggester.promise;
	}

	public constructor(
		app: App,
		private items: string[],
		readonly selectedItems: string[] = [],
		private readonly header?: string
	) {
		super(app);
		// This clones the item so that we don't get any unexpected modifications of the
		// arguments
		this._selectedItems = [...selectedItems];

		this.promise = new Promise<string[]>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});

		this.display();
		this.open();
		this.picker.focusSearchOnOpen();
	}

	// Obsidian handles Esc in the modal's scope before the search box sees the
	// key, so the first Esc clears a search here instead of closing the prompt.
	override onEscapeKey(evt: KeyboardEvent): void {
		if (this.picker.clearSearch()) {
			evt.preventDefault();
			return;
		}
		super.onEscapeKey(evt);
	}

	private display() {
		this.contentEl.empty();
		this.containerEl.addClass(
			"quickAddModal",
			"qaSearchableMultiSelectModal",
			"checkboxPrompt",
		);
		if (this.header) this.titleEl.textContent = this.header;
		this.addSearchableOptions();
		this.addSubmitButton();
	}

	onClose() {
		super.onClose();

		if (!this.resolved) this.rejectPromise(promptCancelled());
	}

	private addSearchableOptions() {
		this.picker = new SearchableMultiSelect(this.contentEl, {
			items: this.items.map((item) => ({
				key: item,
				value: item,
				label: item,
			})),
			isSelected: ({ value }) => this._selectedItems.includes(value),
			onToggle: ({ value }, selected) => {
				if (selected) {
					if (!this._selectedItems.includes(value)) {
						this._selectedItems.push(value);
					}
					return;
				}
				this._selectedItems = this._selectedItems.filter(
					(selectedItem) => selectedItem !== value,
				);
			},
			getSelectedCount: () => new Set(this._selectedItems).size,
		});
	}

	private addSubmitButton() {
		const submitButtonContainer: HTMLDivElement = this.contentEl.createDiv(
			"submitButtonContainer",
		);
		// Cancelling rejects (like Esc) so the caller can distinguish it from an
		// empty submission. Cancel comes first, as in QuickAdd's other prompts.
		const cancelButton: ButtonComponent = new ButtonComponent(
			submitButtonContainer
		);

		cancelButton.setButtonText("Cancel").onClick(() => {
			this.close();
		});

		const submitButton: ButtonComponent = new ButtonComponent(
			submitButtonContainer
		);

		submitButton
			.setButtonText("Submit")
			.setCta()
			.onClick(() => {
				this.resolved = true;
				this.resolvePromise(this._selectedItems);

				this.close();
			});
	}
}
