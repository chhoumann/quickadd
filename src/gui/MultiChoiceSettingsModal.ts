import type { App } from "obsidian";
import { ButtonComponent, Modal, Setting } from "obsidian";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type { MultiChoiceDisplayMode } from "../types/choices/IMultiChoice";

export class MultiChoiceSettingsModal extends Modal {
	public waitForClose: Promise<IMultiChoice | undefined>;
	private resolvePromise!: (choice: IMultiChoice | undefined) => void;
	private rejectPromise!: (reason?: unknown) => void;
	private didSubmit = false;

	private name: string;
	private placeholder: string;
	private displayMode: MultiChoiceDisplayMode;

	constructor(app: App, private choice: IMultiChoice) {
		super(app);
		this.name = choice.name;
		this.placeholder = choice.placeholder ?? "";
		this.displayMode = choice.displayMode ?? "suggester";

		this.waitForClose = new Promise<IMultiChoice | undefined>(
			(resolve, reject) => {
				this.resolvePromise = resolve;
				this.rejectPromise = reject;
			},
		);

		this.containerEl.addClass("quickAddModal", "qaMultiChoiceSettingsModal");
		this.display();
		this.open();
	}

	private display() {
		this.contentEl.empty();
		this.titleEl.setText("Edit Multi Choice");

		new Setting(this.contentEl)
			.setName("Name")
			.addText((text) => {
				text.setValue(this.name).onChange((value) => {
					this.name = value;
				});
			});

		new Setting(this.contentEl)
			.setName("Placeholder")
			.setDesc(
				"Shown in the choice picker search box when this multi choice opens. Leave blank to use the multi name.",
			)
			.addText((text) => {
				text.setPlaceholder("Defaults to the multi name");
				text.setValue(this.placeholder).onChange((value) => {
					this.placeholder = value;
				});
			});

		new Setting(this.contentEl)
			.setName("Open with")
			.setDesc(
				"The normal choice picker supports fuzzy search. Compact menu opens a small launch menu near the active editor when possible. Child choices keep their own configured behavior.",
			)
			.addDropdown((dropdown) => {
				dropdown
					.addOption("suggester", "Choice picker")
					.addOption("context-menu", "Compact menu near editor")
					.setValue(this.displayMode)
					.onChange((value) => {
						this.displayMode =
							value === "context-menu" ? "context-menu" : "suggester";
					});
			});

		const buttonRow = this.contentEl.createDiv();
		new ButtonComponent(buttonRow)
			.setButtonText("Save")
			.setCta()
			.onClick(() => this.submit());
		new ButtonComponent(buttonRow)
			.setButtonText("Cancel")
			.onClick(() => this.cancel());
		buttonRow.addClass("qa-modal-button-row");
	}

	private submit() {
		if (this.didSubmit) return;
		this.didSubmit = true;
		this.close();
	}

	private cancel() {
		this.close();
	}

	onClose() {
		super.onClose();
		if (!this.didSubmit) {
			this.rejectPromise("No input given.");
			return;
		}

		const trimmedPlaceholder = this.placeholder.trim();
		const updated: IMultiChoice = {
			...this.choice,
			name: this.name.trim() || this.choice.name,
			placeholder: trimmedPlaceholder ? trimmedPlaceholder : undefined,
			displayMode:
				this.displayMode === "context-menu" ? "context-menu" : undefined,
		};
		this.resolvePromise(updated);
	}
}
