import type { App } from "obsidian";
import { Modal } from "obsidian";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import ExportPackageModalComponent from "./ExportPackageModal.svelte";
import { mountComponent, type MountHandle } from "../svelte/mountComponent";

export class ExportPackageModal extends Modal {
	private handle: MountHandle | null = null;

	constructor(
		app: App,
		private plugin: QuickAdd,
		private choices: IChoice[],
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("quickAddModal", "packageExportModal");
		this.handle = mountComponent(this.contentEl, ExportPackageModalComponent, {
			app: this.app,
			plugin: this.plugin,
			allChoices: this.choices,
			close: () => this.close(),
		});
	}

	onClose(): void {
		this.handle?.destroy();
		this.handle = null;
	}
}
