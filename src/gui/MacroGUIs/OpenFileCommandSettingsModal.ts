import type { App } from "obsidian";
import { Modal, Setting, ButtonComponent } from "obsidian";
import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";
import { NewTabDirection } from "../../types/newTabDirection";
import type { OpenLocation } from "../../types/fileOpening";
import { CommandType } from "../../types/macros/CommandType";

export class OpenFileCommandSettingsModal extends Modal {
	public waitForClose: Promise<IOpenFileCommand | null>;
	private resolvePromise: (command: IOpenFileCommand | null) => void;
	private command: IOpenFileCommand;
	private originalCommand: IOpenFileCommand;
	private isResolved = false;

	constructor(app: App, command: IOpenFileCommand) {
		super(app);
		this.originalCommand = command;
		this.command = { ...command, type: CommandType.OpenFile }; // copy and ensure type

		// Backfill defaults for legacy commands
		this.command.focus = this.command.focus ?? true;
		this.command.location = this.command.location ?? this.deriveLocation();

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
		this.addOpenLocationSetting();
		this.addFocusSetting();

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



	private addOpenLocationSetting() {
		new Setting(this.contentEl)
			.setName("Where to open")
			.setDesc("Choose tab, split, window, or sidebar")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("reuse", "Reuse active tab")
					.addOption("tab", "New tab")
					.addOption("split", "Split")
					.addOption("window", "New window")
					.addOption("left-sidebar", "Left sidebar")
					.addOption("right-sidebar", "Right sidebar")
					.setValue((this.command.location ?? this.deriveLocation()).toString())
					.onChange((value) => {
						this.command.location = value as OpenLocation;
						if (value !== "split") {
							this.command.direction = undefined;
						} else if (!this.command.direction) {
							this.command.direction = NewTabDirection.vertical;
						}
						this.reload();
					});
			});

		if ((this.command.location ?? this.deriveLocation()) === "split") {
			this.addDirectionSetting();
		}
	}

	private addDirectionSetting() {
		new Setting(this.contentEl)
			.setName("Split direction")
			.setDesc("Which direction to split when opening")
			.addDropdown((dropdown) => {
				dropdown
					.addOption(NewTabDirection.vertical, "Vertical")
					.addOption(NewTabDirection.horizontal, "Horizontal")
					.setValue(this.command.direction ?? NewTabDirection.vertical)
					.onChange((value) => {
						this.command.direction = value as NewTabDirection;
					});
			});
	}

	private addFocusSetting() {
		new Setting(this.contentEl)
			.setName("Focus opened tab")
			.setDesc("Bring the opened file to the foreground")
			.addToggle((toggle) =>
				toggle
					.setValue(this.command.focus ?? true)
					.onChange((value) => {
						this.command.focus = value;
					})
			);
	}

	private deriveLocation(): OpenLocation {
		if (this.command.location) return this.command.location;
		if (this.command.openInNewTab) {
			return this.command.direction ? "split" : "tab";
		}
		return "reuse";
	}



	private addButtonBar() {
		const buttonContainer = this.contentEl.createDiv();
		buttonContainer.style.display = "flex";
		buttonContainer.style.justifyContent = "flex-end";
		buttonContainer.style.gap = "8px";
		buttonContainer.style.marginTop = "20px";

		const cancelButton = new ButtonComponent(buttonContainer);
		cancelButton
			.setButtonText("Cancel")
			.onClick(() => {
				// Return null to indicate cancellation
				this.resolveWithGuard(null);
				this.close();
			});

		const saveButton = new ButtonComponent(buttonContainer);
		saveButton
			.setButtonText("Save")
			.setCta()
			.onClick(() => {
				this.resolveWithGuard(this.command);
				this.close();
			});
	}

	private reload() {
		this.display();
	}
}
