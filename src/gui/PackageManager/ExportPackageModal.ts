import type { App } from "obsidian";
import { Modal } from "obsidian";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import ExportPackageModalComponent from "./ExportPackageModal.svelte";

export class ExportPackageModal extends Modal {
	private component: ExportPackageModalComponent | null = null;

	constructor(
		app: App,
		private plugin: QuickAdd,
		private choices: IChoice[],
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("quickAddModal", "packageExportModal");
		this.component = new ExportPackageModalComponent({
			target: this.contentEl,
			props: {
				app: this.app,
				plugin: this.plugin,
				allChoices: this.choices,
				close: () => this.close(),
			},
		});
	}

	onClose(): void {
		if (this.component) {
			this.component.$destroy();
			this.component = null;
		}
	}
}
