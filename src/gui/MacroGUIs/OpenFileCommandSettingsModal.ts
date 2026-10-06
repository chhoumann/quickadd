import type { App } from "obsidian";
import { Modal, Setting, ButtonComponent } from "obsidian";
import type { FileViewMode2, OpenLocation } from "../../types/fileOpening";
import type { OpenStep } from "../../v3/model";

/**
 * The settings of an Open a note step. It edits the step, so it can hold a
 * view mode, which the v2 Open file command has no field for: the sequence
 * page stores the edited step as the command it lowers to.
 */
export class OpenFileCommandSettingsModal extends Modal {
	public waitForClose: Promise<OpenStep | null>;
	private resolvePromise: (step: OpenStep | null) => void;
	private step: OpenStep;
	private isResolved = false;

	constructor(app: App, step: OpenStep) {
		super(app);
		this.step = { ...step };

		this.waitForClose = new Promise<OpenStep | null>((resolve) => {
			this.resolvePromise = resolve;
		});

		this.display();
		this.open();
	}

	onClose() {
		super.onClose();
		// Dismissing via Esc / click-outside / X discards edits (resolve null),
		// matching the sibling Conditional/Branch modals. Only the Save button
		// commits the working copy (it resolves before close()).
		this.resolveWithGuard(null);
	}

	private resolveWithGuard(value: OpenStep | null) {
		if (!this.isResolved) {
			this.resolvePromise(value);
			this.isResolved = true;
		}
	}

	private display() {
		this.containerEl.addClass("quickAddModal", "openFileCommandSettingsModal");
		this.contentEl.empty();

		const headerEl = this.contentEl.createEl("h2");
		headerEl.textContent = "Open a note";
		headerEl.addClass("qa-modal-title");

		this.addFilePathSetting();
		this.addOpenLocationSetting();
		this.addViewSetting();
		this.addFocusSetting();

		this.addButtonBar();
	}

	private addFilePathSetting() {
		new Setting(this.contentEl)
			.setName("Note path")
			.setDesc("Path to the note. Supports formatting like {{DATE}}, {{VALUE}}, etc.")
			.addText(text => text
				.setPlaceholder("{{DATE}}todo.md")
				.setValue(this.step.note)
				.onChange(value => {
					this.step.note = value;
					this.step.name = `Open note: ${value}`;
				})
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
					.setValue(this.step.location)
					.onChange((value: OpenLocation) => {
						this.step.location = value;
						this.display();
					});
			});

		if (this.step.location === "split") {
			this.addDirectionSetting();
		}
	}

	private addDirectionSetting() {
		new Setting(this.contentEl)
			.setName("Split direction")
			.setDesc("How to arrange the new pane relative to the current one")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("vertical", "Split right")
					.addOption("horizontal", "Split down")
					.setValue(this.step.direction)
					.onChange((value) => {
						this.step.direction = value as OpenStep["direction"];
					});
			});
	}

	private addViewSetting() {
		const views: { value: string; label: string }[] = [
			{ value: "default", label: "As saved" },
			{ value: "source", label: "Source mode" },
			{ value: "preview", label: "Reading view" },
			{ value: "live", label: "Live Preview" },
		];
		new Setting(this.contentEl)
			.setName("View")
			.addDropdown((dropdown) => {
				for (const { value, label } of views) dropdown.addOption(value, label);
				dropdown
					.setValue(viewOf(this.step.mode))
					.onChange((value) => {
						this.step.mode = value as FileViewMode2;
					});
			});
	}

	private addFocusSetting() {
		new Setting(this.contentEl)
			.setName("Focus opened note")
			.setDesc("Bring the opened note to the foreground")
			.addToggle((toggle) =>
				toggle
					.setValue(this.step.focus)
					.onChange((value) => {
						this.step.focus = value;
					})
			);
	}

	private addButtonBar() {
		const buttonContainer = this.contentEl.createDiv({
			cls: "qa-command-button-row qa-command-button-row-compact",
		});

		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => {
				this.resolveWithGuard(null);
				this.close();
			});

		new ButtonComponent(buttonContainer)
			.setButtonText("Save")
			.setCta()
			.onClick(() => {
				this.resolveWithGuard(this.step);
				this.close();
			});
	}
}

/** The View option a saved mode shows as; data.json can hold a mode as an object. */
function viewOf(mode: FileViewMode2): string {
	if (typeof mode === "string") return mode === "live-preview" ? "live" : mode;
	if (mode.mode === "source") return mode.source ? "source" : "live";
	return mode.mode;
}
