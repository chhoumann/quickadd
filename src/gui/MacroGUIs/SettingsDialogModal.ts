import type { App } from "obsidian";
import { ButtonComponent, Modal } from "obsidian";

/**
 * A macro step's settings dialog, where only Save commits. `waitForClose`
 * resolves with what `save()` returns, or with null when the dialog closes any
 * other way: Cancel, Esc, a click outside, or the X.
 */
export abstract class SettingsDialogModal<T> extends Modal {
	public readonly waitForClose: Promise<T | null>;
	private resolvePromise!: (value: T | null) => void;
	private isResolved = false;

	constructor(app: App) {
		super(app);
		this.waitForClose = new Promise<T | null>((resolve) => {
			this.resolvePromise = resolve;
		});
	}

	/** The value Save commits, or null to keep the dialog open (e.g. invalid input). */
	protected abstract save(): T | null;

	/** Undoes edits made in place when the dialog closes without Save. */
	protected discard(): void {}

	protected addSaveCancelButtons(cls = "qa-command-button-row"): void {
		const row = this.contentEl.createDiv({ cls });
		new ButtonComponent(row).setButtonText("Cancel").onClick(() => this.close());
		new ButtonComponent(row)
			.setButtonText("Save")
			.setCta()
			.onClick(() => {
				const value = this.save();
				if (value === null) return;
				this.settle(value);
				this.close();
			});
	}

	onClose(): void {
		super.onClose();
		if (this.isResolved) return;
		this.discard();
		this.settle(null);
	}

	private settle(value: T | null): void {
		if (this.isResolved) return;
		this.isResolved = true;
		this.resolvePromise(value);
	}
}
