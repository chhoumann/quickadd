import type { App } from "obsidian";
import { Modal } from "obsidian";
import type QuickAdd from "../../main";
import type { ApplyImportResult } from "../../services/packageImportService";
import type IChoice from "../../types/choices/IChoice";
import { syncImportedChoiceCommands } from "../../services/packageImportCommands";
import ImportPackageModalComponent from "./ImportPackageModal.svelte";
import { mountComponent, type MountHandle } from "../svelte/mountComponent";

export class ImportPackageModal extends Modal {
	private handle: MountHandle | null = null;

	constructor(
		app: App,
		private readonly plugin: QuickAdd,
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
				onImported: (result: ApplyImportResult, previousChoices: IChoice[]) =>
					syncImportedChoiceCommands(this.plugin, previousChoices, result),
			},
			{ what: "the package importer" },
		);
	}

	onClose(): void {
		this.handle?.destroy();
		this.handle = null;
	}
}
