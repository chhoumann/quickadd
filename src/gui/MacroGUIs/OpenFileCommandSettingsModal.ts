import type { App } from "obsidian";
import { Setting } from "obsidian";
import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";
import { NewTabDirection } from "../../types/newTabDirection";
import type { OpenLocation } from "../../types/fileOpening";
import { CommandType } from "../../types/macros/CommandType";
import { openLocationOptions, splitDirectionOptions } from "../ChoiceBuilder/fileOpeningOptions";
import { SettingsDialogModal } from "./SettingsDialogModal";

/** Edits a working copy of the step; Save resolves it, anything else resolves null. */
export class OpenFileCommandSettingsModal extends SettingsDialogModal<IOpenFileCommand> {
	private command: IOpenFileCommand;

	constructor(app: App, command: IOpenFileCommand) {
		super(app);
		this.command = { ...command, type: CommandType.OpenFile }; // copy and ensure type

		// Backfill defaults for legacy commands
		this.command.focus = this.command.focus ?? true;
		this.command.location = this.command.location ?? this.deriveLocation();
		this.syncLegacyFlagsFromLocation(this.command.location);

		this.display();
		this.open();
	}

	protected save(): IOpenFileCommand {
		return this.command;
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "openFileCommandSettingsModal");
		this.contentEl.empty();

		const headerEl = this.contentEl.createEl("h2");
		headerEl.textContent = "Open file command settings";
		headerEl.addClass("qa-modal-title");

		this.addFilePathSetting();
		this.addOpenLocationSetting();
		this.addFocusSetting();

		this.addSaveCancelButtons("qa-command-button-row qa-command-button-row-compact");
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
				for (const { value, label } of openLocationOptions) {
					dropdown.addOption(value, label);
				}

				dropdown
					.setValue(this.deriveLocation())
					.onChange((value: OpenLocation) => {
						this.command.location = value;
						this.syncLegacyFlagsFromLocation(value);
						this.reload();
					});
			});

		if (this.deriveLocation() === "split") {
			this.addDirectionSetting();
		}
	}

	private syncLegacyFlagsFromLocation(value: OpenLocation) {
		switch (value) {
			case "split":
				this.command.openInNewTab = true;
				if (!this.command.direction) {
					this.command.direction = NewTabDirection.vertical;
				}
				break;
			case "tab":
			case "reuse":
				this.command.openInNewTab = false;
				this.command.direction = undefined;
				break;
			default:
				this.command.openInNewTab = true;
				this.command.direction = undefined;
				break;
		}
	}

	private addDirectionSetting() {
		new Setting(this.contentEl)
			.setName("Split direction")
			.setDesc("How to arrange the new pane relative to the current one")
			.addDropdown((dropdown) => {
				for (const { value, label } of splitDirectionOptions) {
					dropdown.addOption(value, label);
				}
				dropdown
					.setValue(this.command.direction ?? NewTabDirection.vertical)
					.onChange((value) => {
						this.command.direction = value as NewTabDirection;
					});
			});
	}

	private addFocusSetting() {
		new Setting(this.contentEl)
			.setName("Focus opened file")
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
			return "split";
		}
		return "reuse";
	}

	private reload() {
		this.display();
	}
}
