import type { App } from "obsidian";
import { Modal } from "obsidian";
import ImportPackageModalComponent from "./ImportPackageModal.svelte";

export class ImportPackageModal extends Modal {
	private component: ImportPackageModalComponent | null = null;

	constructor(app: App) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("quickAddModal", "packageImportModal");
		this.component = new ImportPackageModalComponent({
			target: this.contentEl,
			props: {
				app: this.app,
				close: () => this.close(),
			},
		});
	}

	onClose(): void {
		this.component?.$destroy();
		this.component = null;
	}
}
