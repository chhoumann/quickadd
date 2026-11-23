import type { App } from "obsidian";
import type { ChoiceBuilderPlugin } from "../../types/pluginContext";
import type IChoice from "../../types/choices/IChoice";
import type ITemplateChoice from "../../types/choices/ITemplateChoice";
import { normalizeFileOpening } from "../../utils/fileOpeningDefaults";
import { ChoiceBuilder } from "./choiceBuilder";
import TemplateChoiceForm from "./TemplateChoiceForm.svelte";

export class TemplateChoiceBuilder extends ChoiceBuilder<ITemplateChoice> {
	constructor(
		app: App,
		choice: ITemplateChoice,
		plugin: ChoiceBuilderPlugin,
		onSave: (choice: IChoice) => void,
	) {
		super(app, choice, plugin, onSave, TemplateChoiceForm, "this template choice's settings");
		this.containerEl.addClass("templateChoiceBuilder");
		this.normalizeChoice();
	}

	/** Fills in missing fields once, before mount, so reads see a fully-shaped object. */
	private normalizeChoice() {
		this.choice.fileExistsBehavior ??= { kind: "prompt" };
		this.choice.fileOpening = normalizeFileOpening(this.choice.fileOpening);
		// A hand-edited or imported choice can lack these configs entirely or
		// carry partial objects (e.g. `folder: { enabled: true }` with no
		// `folders` array), which would throw during mount. Backfill field by
		// field, mirroring the shapes the TemplateChoice constructor creates.
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
		// chooseFromSubfolders postdates the folder config itself, so older
		// choices legitimately lack it.
		this.choice.folder.chooseFromSubfolders ??= false;
	}
}
