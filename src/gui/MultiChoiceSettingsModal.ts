import type { App } from "obsidian";
import { ButtonComponent, Modal, Setting } from "obsidian";
import type IMultiChoice from "../types/choices/IMultiChoice";
import { addChoiceIconSetting } from "./ChoiceBuilder/components/choiceIconSetting";

export class MultiChoiceSettingsModal extends Modal {
	public waitForClose: Promise<IMultiChoice | undefined>;
	private resolvePromise!: (choice: IMultiChoice | undefined) => void;
	private rejectPromise!: (reason?: unknown) => void;
	private didSubmit = false;

	private name: string;
	private placeholder: string;
	private icon: string | undefined;

	constructor(app: App, private choice: IMultiChoice) {
		super(app);
		this.name = choice.name;
		this.placeholder = choice.placeholder ?? "";
		this.icon = typeof choice.icon === "string" ? choice.icon : undefined;

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
		this.titleEl.setText("Edit folder");

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
				"Shown in the choice picker search box when this folder opens. Leave blank to use the folder name.",
			)
			.addText((text) => {
				text.setPlaceholder("Defaults to the folder name");
				text.setValue(this.placeholder).onChange((value) => {
					this.placeholder = value;
				});
			});

		addChoiceIconSetting(
			this.app,
			this.contentEl,
			{ type: this.choice.type, icon: this.icon },
			(icon) => {
				this.icon = icon;
			},
		);

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
			icon: this.icon,
		};
		this.resolvePromise(updated);
	}
}
