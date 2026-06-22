import type { App } from "obsidian";
import { Modal, Notice, Setting } from "obsidian";
import { normalizeDisplayItem } from "../suggesters/utils";

export interface MultiSuggesterOptions {
	/** Modal title / prompt header. */
	placeholder?: string;
	/** Allow typing a value that isn't in the option list (|custom). */
	allowCustomValue?: boolean;
	/** Optional token: a "Skip" affordance resolves an empty selection. */
	skippable?: boolean;
}

/**
 * A modal multi-select for `{{VALUE:a,b,c|multi}}`. Each option is a toggle;
 * the resolved value is the ordered list of selected option VALUES (display
 * labels map back to their values), followed by any custom additions. Resolves
 * `string[]` on Done, `[]` on Skip, and rejects (cancels the run) on
 * Cancel/Esc — mirroring GenericSuggester's reject-on-dismiss contract.
 */
export default class MultiSuggester extends Modal {
	public waitForClose: Promise<string[]>;
	private resolvePromise!: (values: string[]) => void;
	private rejectPromise!: (reason?: unknown) => void;
	private didSubmit = false;
	private skipped = false;

	private readonly items: string[];
	private readonly displayItems: string[];
	private readonly opts: MultiSuggesterOptions;
	private readonly selected = new Set<string>();
	private readonly customValues: string[] = [];
	// The in-progress custom-value text. Held on the instance (not a render-scoped
	// local) so submit() can fold an un-"Add"ed draft into the result instead of
	// silently dropping it.
	private draft = "";

	public static Suggest(
		app: App,
		displayItems: string[],
		items: string[],
		options: MultiSuggesterOptions = {},
	): Promise<string[]> {
		return new MultiSuggester(app, displayItems, items, options).waitForClose;
	}

	constructor(
		app: App,
		displayItems: string[],
		items: string[],
		options: MultiSuggesterOptions = {},
	) {
		super(app);
		this.items = items;
		this.displayItems =
			displayItems.length === items.length ? displayItems : items;
		this.opts = options;
		this.waitForClose = new Promise<string[]>((resolve, reject) => {
			this.resolvePromise = resolve;
			this.rejectPromise = reject;
		});
		this.render();
		this.open();
	}

	private render() {
		this.containerEl.addClass("quickAddModal", "qaMultiSuggester");
		this.titleEl.setText(this.opts.placeholder ?? "Select one or more");
		const { contentEl } = this;
		contentEl.empty();

		const list = contentEl.createDiv({ cls: "qa-multi-list" });
		const rows = [
			...this.items.map((value, i) => ({
				value,
				display: normalizeDisplayItem(this.displayItems[i] ?? value),
			})),
			...this.customValues.map((value) => ({ value, display: value })),
		];
		for (const { value, display } of rows) {
			new Setting(list).setName(display).addToggle((toggle) =>
				toggle.setValue(this.selected.has(value)).onChange((on) => {
					if (on) this.selected.add(value);
					else this.selected.delete(value);
				}),
			);
		}

		if (this.opts.allowCustomValue) {
			new Setting(contentEl)
				.setName("Add a custom value")
				.addText((text) => {
					text
						.setPlaceholder("Not in the list…")
						.setValue(this.draft)
						.onChange((v) => (this.draft = v));
					text.inputEl.addClass("qa-multi-custom-input");
					// Enter is the natural "commit this value" gesture; without it the
					// typed value is only added by the explicit "Add" button and is
					// otherwise silently lost.
					text.inputEl.addEventListener("keydown", (evt) => {
						if (evt.key === "Enter") {
							evt.preventDefault();
							this.commitDraft();
						}
					});
				})
				.addButton((btn) =>
					btn.setButtonText("Add").onClick(() => this.commitDraft()),
				);
		}

		const buttons = new Setting(contentEl);
		buttons.addButton((btn) =>
			btn.setButtonText("Done").setCta().onClick(() => this.submit()),
		);
		buttons.addButton((btn) =>
			btn.setButtonText("Cancel").onClick(() => this.close()),
		);
		if (this.opts.skippable) {
			buttons.addButton((btn) =>
				btn
					.setButtonText("Skip")
					.setTooltip("Leave empty")
					.onClick(() => {
						this.skipped = true;
						this.didSubmit = true;
						this.close();
					}),
			);
		}
	}

	/**
	 * Commit the current custom-value draft into the selection. Returns `false`
	 * (with a Notice) for blank or duplicate input so the user gets feedback instead
	 * of a silent no-op; on success the draft is cleared and the list re-rendered with
	 * focus restored to the custom-value field for rapid multi-add.
	 */
	private commitDraft(): boolean {
		const trimmed = this.draft.trim();
		if (!trimmed) {
			new Notice("Enter a value to add.");
			return false;
		}
		const alreadySelected =
			(this.items.includes(trimmed) || this.customValues.includes(trimmed)) &&
			this.selected.has(trimmed);
		if (alreadySelected) {
			new Notice(`"${trimmed}" is already added.`);
			return false;
		}
		if (
			!this.items.includes(trimmed) &&
			!this.customValues.includes(trimmed)
		) {
			this.customValues.push(trimmed);
		}
		this.selected.add(trimmed);
		this.draft = "";
		this.render();
		// render() rebuilds contentEl, dropping focus from the (now-recreated) custom
		// input; restore it so adding several values in a row stays fluid.
		this.focusCustomInput();
		return true;
	}

	private focusCustomInput(): void {
		const input = this.contentEl.querySelector<HTMLInputElement>(
			".qa-multi-custom-input",
		);
		input?.focus();
	}

	private submit() {
		// Fold any non-empty, un-"Add"ed draft into the selection so a user who typed a
		// value and pressed Done (the common submit gesture) doesn't silently lose it.
		if (this.opts.allowCustomValue && this.draft.trim()) {
			const trimmed = this.draft.trim();
			if (
				!this.items.includes(trimmed) &&
				!this.customValues.includes(trimmed)
			) {
				this.customValues.push(trimmed);
			}
			this.selected.add(trimmed);
			this.draft = "";
		}
		this.didSubmit = true;
		this.close();
	}

	/** Selected values in option order, then custom additions in add order. */
	private collectResult(): string[] {
		const ordered: string[] = [];
		for (const value of this.items) {
			if (this.selected.has(value)) ordered.push(value);
		}
		for (const value of this.customValues) {
			if (this.selected.has(value)) ordered.push(value);
		}
		return ordered;
	}

	onClose() {
		super.onClose();
		if (this.didSubmit) {
			this.resolvePromise(this.skipped ? [] : this.collectResult());
		} else {
			this.rejectPromise("no input given.");
		}
	}
}
