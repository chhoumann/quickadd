import type { App } from "obsidian";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { Step } from "../../v3/model";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import { normalizeFileOpening } from "../../utils/fileOpeningDefaults";
import { ChoiceBuilder } from "./choiceBuilder";
import TemplateChoiceForm from "./TemplateChoiceForm.svelte";

export class TemplateChoiceBuilder extends ChoiceBuilder<ITemplateChoice> {
	constructor(
		app: App,
		choice: ITemplateChoice,
		plugin: QuickAdd,
		onSave: (choice: IChoice) => void,
		onAddStep?: (step: Step) => void,
	) {
		super(app, choice, plugin, onSave, TemplateChoiceForm, "this template choice's settings", onAddStep);
		this.containerEl.addClass("templateChoiceBuilder");
		this.normalizeChoice();
	}

	/**
	 * Apply the defaults the imperative builder used to set lazily inside render
	 * branches — once, before mount, so reads see a fully-shaped object.
	 */
	private normalizeChoice() {
		this.choice.fileExistsBehavior ??= { kind: "prompt" };
		this.choice.fileOpening = normalizeFileOpening(this.choice.fileOpening);
		// A hand-edited or imported choice can lack these configs entirely OR
		// carry partial objects (e.g. `folder: { enabled: true }` with no
		// `folders` array) — without per-field backfills the builder throws
		// during mount and the modal opens blank (#1497 class). Field-by-field,
		// mirroring the shapes the TemplateChoice ctor creates.
		this.choice.templatePath ??= "";
		this.choice.fileNameFormat ??= { enabled: false, format: "" };
		this.choice.fileNameFormat.enabled ??= false;
		this.choice.fileNameFormat.format ??= "";
		this.choice.folder ??= {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		};
		this.choice.folder.enabled ??= false;
		this.choice.folder.folders ??= [];
		this.choice.folder.chooseWhenCreatingNote ??= false;
		this.choice.folder.createInSameFolderAsActiveFile ??= false;
		// chooseFromSubfolders (2023) postdates the folder config itself, so
		// choices saved before it existed legitimately lack it (#1497).
		this.choice.folder.chooseFromSubfolders ??= false;
	}
}
