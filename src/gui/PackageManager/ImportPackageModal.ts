import type { App } from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import type { ApplyImportResult } from "../../services/packageImportService";
import ImportPackageModalComponent from "./ImportPackageModal.svelte";
import { SvelteModal } from "../svelte/SvelteModal";

export function openImportPackageModal(
	app: App,
	onImported?: (result: ApplyImportResult, previousChoices: IChoice[]) => void,
): void {
	new SvelteModal(app, {
		title: "Import QuickAdd package",
		cls: ["quickAddModal", "qa-package-modal", "packageImportModal"],
		component: ImportPackageModalComponent,
		props: (close) => ({ app, close, onImported }),
		what: "the package importer",
	}).open();
}
