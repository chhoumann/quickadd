import type { App } from "obsidian";
import { Modal, Setting, ButtonComponent } from "obsidian";
import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";
import { NewTabDirection } from "../../types/newTabDirection";

export class OpenFileCommandSettingsModal extends Modal {
	public waitForClose: Promise<IOpenFileCommand | null>;
	private resolvePromise: (command: IOpenFileCommand | null) => void;
	private command: IOpenFileCommand;
	private originalCommand: IOpenFileCommand;
	private isResolved = false;

	constructor(app: App, command: IOpenFileCommand) {
		super(app);
		this.originalCommand = command;
		this.command = { ...command }; // Create a copy to avoid mutating original

		this.waitForClose = new Promise<IOpenFileCommand | null>((resolve) => {
			this.resolvePromise = resolve;
		});

		this.display();
		this.open();
	}

	onClose() {
		super.onClose();
		if (!this.isResolved) {
			this.resolvePromise(this.command);
			this.isResolved = true;
		}
	}

	private resolveWithGuard(value: IOpenFileCommand | null) {
		if (!this.isResolved) {
			this.resolvePromise(value);
			this.isResolved = true;
		}
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "openFileCommandSettingsModal");
		this.contentEl.empty();

		const headerEl = this.contentEl.createEl("h2");
		headerEl.textContent = "Open File Command Settings";
		headerEl.style.textAlign = "center";

		this.addFilePathSetting();
		this.addOpenInNewTabSetting();
		
		if (this.command.openInNewTab) {
			this.addDirectionSetting();
		}
		
		this.addButtonBar();
	}

	private addFilePathSetting() {
		new Setting(this.contentEl)
			.setName("File path")
			.setDesc("Path to the file. Supports formatting like {{DATE}}, {{VALUE}}, etc.")
			.addText(text => text
				.setPlaceholder("{{DATE}}todo.md")
				.setValue(this.command.filePath)
				.onChange(value => {
					this.command.filePath = value;
					this.command.name = `Open file: ${value}`;
				})
			);
	}



	private addOpenInNewTabSetting() {
		new Setting(this.contentEl)
			.setName("Open in new tab")
			.setDesc("Open the file in a new tab")
			.addToggle(toggle => toggle
				.setValue(this.command.openInNewTab || false)
				.onChange(value => {
					this.command.openInNewTab = value;
					// Clear direction when new tab is disabled
					if (!value) {
						this.command.direction = undefined;
					}
					this.reload();
				})
			);
	}

	private addDirectionSetting() {
		new Setting(this.contentEl)
			.setName("Split direction")
			.setDesc("Which direction to split when opening in new tab")
			.addDropdown(dropdown => {
				dropdown
					.addOption("", "No split")
					.addOption(NewTabDirection.horizontal, "Horizontal")
					.addOption(NewTabDirection.vertical, "Vertical")
					.setValue(this.command.direction || "")
					.onChange(value => {
						this.command.direction = value as NewTabDirection || undefined;
					});
			});
	}



	private addButtonBar() {
		const buttonContainer = this.contentEl.createDiv();
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "space-between";
		buttonContainer.style.marginTop = "20px";

		const saveButton = new ButtonComponent(buttonContainer);
		saveButton
			.setButtonText("Save")
			.setCta()
			.onClick(() => {
				this.resolveWithGuard(this.command);
				this.close();
			});

		const cancelButton = new ButtonComponent(buttonContainer);
		cancelButton
			.setButtonText("Cancel")
			.onClick(() => {
				// Return null to indicate cancellation
				this.resolveWithGuard(null);
				this.close();
			});
	}

	private reload() {
		this.display();
	}
}
