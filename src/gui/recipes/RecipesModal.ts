import type { App } from "obsidian";
import { Modal } from "obsidian";
import type QuickAdd from "../../main";
import type { ApplyImportResult } from "../../services/packageImportService";
import type IChoice from "../../types/choices/IChoice";
import { syncImportedChoiceCommands } from "../../services/packageImportCommands";
import { mountComponent, type MountHandle } from "../svelte/mountComponent";
import { RECIPES } from "./catalog";
import RecipesModalComponent from "./RecipesModal.svelte";

/** The docs' example workflows, each added with one click through the package import. */
export class RecipesModal extends Modal {
	private handle: MountHandle | null = null;

	constructor(
		app: App,
		private readonly plugin: QuickAdd,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass("quickAddModal", "qa-package-modal", "qa-recipes-modal");
		this.setTitle("Recipes");
		this.handle = mountComponent(
			this.contentEl,
			RecipesModalComponent,
			{
				app: this.app,
				recipes: RECIPES,
				setTitle: (title: string) => this.setTitle(title),
				onImported: (result: ApplyImportResult, previousChoices: IChoice[]) =>
					syncImportedChoiceCommands(this.plugin, previousChoices, result),
			},
			{ what: "the recipes" },
		);
	}

	onClose(): void {
		this.handle?.destroy();
		this.handle = null;
	}
}
