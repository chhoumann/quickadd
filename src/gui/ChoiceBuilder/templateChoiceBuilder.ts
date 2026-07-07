import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import { normalizeFileOpening } from "../../utils/fileOpeningDefaults";
import { mountComponent } from "../svelte/mountComponent";
import { ChoiceBuilder } from "./choiceBuilder";
import TemplateChoiceForm from "./TemplateChoiceForm.svelte";
import {
	createTemplateChoiceFormProps,
	type TemplateChoiceFormProps,
} from "./templateChoiceFormProps.svelte";

export class TemplateChoiceBuilder extends ChoiceBuilder {
	choice: ITemplateChoice;
	private formProps?: TemplateChoiceFormProps;

	constructor(
		app: App,
		choice: ITemplateChoice,
		private plugin: QuickAdd,
	) {
		super(app);
		this.choice = choice;
		this.normalizeChoice();
		this.display();
	}

	/**
	 * Apply the defaults the imperative builder used to set lazily inside render
	 * branches — once, before mount, so reads see a fully-shaped object.
	 */
	private normalizeChoice() {
		this.choice.fileExistsBehavior ??= { kind: "prompt" };
		this.choice.fileOpening = normalizeFileOpening(this.choice.fileOpening);
		// chooseFromSubfolders (2023) postdates the folder config itself, so
		// choices saved before it existed legitimately lack it (#1497).
		this.choice.folder.chooseFromSubfolders ??= false;
	}

	protected display() {
		this.containerEl.addClass("templateChoiceBuilder");
		this.formProps = createTemplateChoiceFormProps({
			choice: this.choice,
			app: this.app,
			plugin: this.plugin,
		});
		this.svelteElements.push(
			mountComponent(this.contentEl, TemplateChoiceForm, this.formProps),
		);
	}

	protected getResultChoice(): IChoice {
		return this.formProps?.choice ?? this.choice;
	}
}
