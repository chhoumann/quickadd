import type { App } from "obsidian";
import { Modal } from "obsidian";
import type { LinkStep, TemplaterStep } from "../../v3/model";
import { mountComponent, type MountHandle } from "../svelte/mountComponent";
import StepSettingsForm from "./StepSettingsForm.svelte";

export type NoteStep = LinkStep | TemplaterStep;

/**
 * The settings of a Link it or Run Templater step. Resolves with the edited
 * step on Save, and null when dismissed.
 */
export class StepSettingsModal extends Modal {
	public readonly waitForClose: Promise<NoteStep | null>;
	private resolvePromise: (step: NoteStep | null) => void;
	private handle: MountHandle | null = null;

	constructor(app: App, private readonly step: NoteStep) {
		super(app);
		this.waitForClose = new Promise((resolve) => {
			this.resolvePromise = resolve;
		});
		this.open();
	}

	onOpen() {
		this.containerEl.addClass("quickAddModal", "qaStepSettingsModal");
		this.handle = mountComponent(
			this.contentEl,
			StepSettingsForm,
			{
				app: this.app,
				step: this.step,
				onSave: (step: NoteStep) => {
					this.resolvePromise(step);
					this.close();
				},
				onCancel: () => this.close(),
			},
			{ what: "this step's settings" },
		);
	}

	onClose() {
		// Resolving twice is a no-op, so Save's value stands.
		this.resolvePromise(null);
		this.handle?.destroy();
		this.handle = null;
	}
}
