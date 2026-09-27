import type { App } from "obsidian";
import { Modal } from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import type { ApplyImportResult } from "../../services/packageImportService";
import ImportPackageModalComponent from "./ImportPackageModal.svelte";
import { mountComponent, type MountHandle } from "../svelte/mountComponent";

export interface ImportPackageModalOptions {
	onImported?: (result: ApplyImportResult, previousChoices: IChoice[]) => void;
}

export class ImportPackageModal extends Modal {
	private handle: MountHandle | null = null;

	constructor(
		app: App,
		private readonly options: ImportPackageModalOptions = {},
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("quickAddModal", "qa-package-modal", "packageImportModal");
		this.setTitle("Import QuickAdd package");
		this.handle = mountComponent(
			this.contentEl,
			ImportPackageModalComponent,
			{
				app: this.app,
				close: () => this.close(),
				onImported: this.options.onImported,
			},
			{ what: "the package importer" },
		);
	}

	onClose(): void {
		this.handle?.destroy();
		this.handle = null;
	}
}
