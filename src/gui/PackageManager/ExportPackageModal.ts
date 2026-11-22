import type { App } from "obsidian";
import type IChoice from "../../types/choices/IChoice";
import ExportPackageModalComponent from "./ExportPackageModal.svelte";
import { SvelteModal } from "../svelte/SvelteModal";

export function openExportPackageModal(
	app: App,
	pluginVersion: string,
	choices: IChoice[],
): void {
	new SvelteModal(app, {
		title: "Export QuickAdd package",
		cls: ["quickAddModal", "qa-package-modal", "packageExportModal"],
		component: ExportPackageModalComponent,
		props: (close) => ({ app, pluginVersion, allChoices: choices, close }),
		what: "the package exporter",
	}).open();
}
