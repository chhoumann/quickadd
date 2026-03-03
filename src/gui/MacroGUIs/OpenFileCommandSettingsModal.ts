import type { App } from "obsidian";
import { Modal, Setting } from "obsidian";
import { createDraftSession, type DraftSession } from "../../state/createDraftSession";
import type { OpenLocation } from "../../types/fileOpening";
import { NewTabDirection } from "../../types/newTabDirection";
import { CommandType } from "../../types/macros/CommandType";
import type { IOpenFileCommand } from "../../types/macros/QuickCommands/IOpenFileCommand";
import { renderModalActionBar } from "./modalActionBar";
import { resolveOpenFileCommandModalResult } from "./openFileCommandModalResult";

export class OpenFileCommandSettingsModal extends Modal {
	public waitForClose: Promise<IOpenFileCommand | null>;
	private resolvePromise: (command: IOpenFileCommand | null) => void;
	private draftSession: DraftSession<IOpenFileCommand>;
	private isResolved = false;
	private splitDirectionSettingEl: HTMLElement | null = null;

	constructor(app: App, command: IOpenFileCommand) {
		super(app);
		const draft = this.createCommandDraft(command);
		this.draftSession = createDraftSession(draft);

		this.waitForClose = new Promise<IOpenFileCommand | null>((resolve) => {
			this.resolvePromise = resolve;
		});

		this.display();
		this.open();
	}

	private get draft(): IOpenFileCommand {
		return this.draftSession.draft;
	}

	onClose() {
		super.onClose();
		if (!this.isResolved) {
			// Close icon and Escape are treated as explicit dismiss/cancel.
			const result = resolveOpenFileCommandModalResult(
				"dismiss",
				this.draftSession,
			);
			this.resolveWithGuard(result);
		}
	}

	private resolveWithGuard(value: IOpenFileCommand | null) {
		if (!this.isResolved) {
			this.resolvePromise(value);
			this.isResolved = true;
		}
	}

	private createCommandDraft(command: IOpenFileCommand): IOpenFileCommand {
		const draft: IOpenFileCommand = {
			...command,
			type: CommandType.OpenFile,
		};

		draft.focus = draft.focus ?? true;
		draft.location = draft.location ?? this.deriveLocationFrom(draft);
		this.syncLegacyFlagsFromLocation(draft.location, draft);
		return draft;
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "openFileCommandSettingsModal");
		this.contentEl.empty();

		const headerEl = this.contentEl.createEl("h2");
		headerEl.textContent = "Open File Command Settings";
		headerEl.style.textAlign = "center";

		this.addFilePathSetting();
		this.addOpenLocationSetting();
		this.addDirectionSetting();
		this.addFocusSetting();
		this.addButtonBar();
		this.syncDirectionSettingVisibility();
	}

	private addFilePathSetting() {
		new Setting(this.contentEl)
			.setName("File path")
			.setDesc("Path to the file. Supports formatting like {{DATE}}, {{VALUE}}, etc.")
			.addText((text) =>
				text
					.setPlaceholder("{{DATE}}todo.md")
					.setValue(this.draft.filePath)
					.onChange((value) => {
						this.draft.filePath = value;
						this.draft.name = `Open file: ${value}`;
					}),
			);
	}

	private addOpenLocationSetting() {
		const locationOptions: { value: OpenLocation; label: string }[] = [
			{ value: "reuse", label: "Reuse active tab" },
			{ value: "tab", label: "New tab" },
			{ value: "split", label: "Split" },
			{ value: "window", label: "New window" },
			{ value: "left-sidebar", label: "Left sidebar" },
			{ value: "right-sidebar", label: "Right sidebar" },
		];

		new Setting(this.contentEl)
			.setName("Where to open")
			.setDesc("Choose tab, split, window, or sidebar")
			.addDropdown((dropdown) => {
				for (const { value, label } of locationOptions) {
					dropdown.addOption(value, label);
				}

				dropdown
					.setValue(this.draft.location ?? this.deriveLocation())
					.onChange((value: OpenLocation) => {
						this.draft.location = value;
						this.syncLegacyFlagsFromLocation(value, this.draft);
						this.syncDirectionSettingVisibility();
					});
			});
	}

	private syncLegacyFlagsFromLocation(
		value: OpenLocation,
		command: IOpenFileCommand,
	) {
		switch (value) {
			case "split":
				command.openInNewTab = true;
				if (!command.direction) {
					command.direction = NewTabDirection.vertical;
				}
				break;
			case "tab":
			case "reuse":
				command.openInNewTab = false;
				command.direction = undefined;
				break;
			default:
				command.openInNewTab = true;
				command.direction = undefined;
				break;
		}
	}

	private addDirectionSetting() {
		const setting = new Setting(this.contentEl)
			.setName("Split direction")
			.setDesc("How to arrange the new pane relative to the current one")
			.addDropdown((dropdown) => {
				dropdown
					.addOption(NewTabDirection.vertical, "Split right")
					.addOption(NewTabDirection.horizontal, "Split down")
					.setValue(this.draft.direction ?? NewTabDirection.vertical)
					.onChange((value) => {
						this.draft.direction = value as NewTabDirection;
					});
			});

		this.splitDirectionSettingEl = setting.settingEl;
	}

	private syncDirectionSettingVisibility() {
		if (!this.splitDirectionSettingEl) {
			return;
		}

		const isSplit = this.deriveLocation() === "split";
		this.splitDirectionSettingEl.style.display = isSplit ? "" : "none";
	}

	private addFocusSetting() {
		new Setting(this.contentEl)
			.setName("Focus opened file")
			.setDesc("Bring the opened file to the foreground")
			.addToggle((toggle) =>
				toggle
					.setValue(this.draft.focus ?? true)
					.onChange((value) => {
						this.draft.focus = value;
					}),
			);
	}

	private deriveLocation(): OpenLocation {
		return this.deriveLocationFrom(this.draft);
	}

	private deriveLocationFrom(command: IOpenFileCommand): OpenLocation {
		if (command.location) return command.location;
		if (command.openInNewTab) {
			return "split";
		}
		return "reuse";
	}

	private addButtonBar() {
		renderModalActionBar({
			parent: this.contentEl,
			gapPx: 8,
			onCancel: () => {
				const result = resolveOpenFileCommandModalResult(
					"cancel",
					this.draftSession,
				);
				this.resolveWithGuard(result);
				this.close();
			},
			onSave: () => {
				const result = resolveOpenFileCommandModalResult(
					"save",
					this.draftSession,
				);
				this.resolveWithGuard(result);
				this.close();
			},
		});
	}
}
