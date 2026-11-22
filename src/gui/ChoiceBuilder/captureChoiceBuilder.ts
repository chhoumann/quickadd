import type { App } from "obsidian";
import { CREATE_IF_NOT_FOUND_TOP } from "../../constants";
import type { ChoiceBuilderPlugin } from "../../types/pluginContext";
import type IChoice from "../../types/choices/IChoice";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { normalizeFileOpening } from "../../utils/fileOpeningDefaults";
import { isCanvasTargetPath } from "./canvasNodes";
import CaptureChoiceForm from "./CaptureChoiceForm.svelte";
import { ChoiceBuilder } from "./choiceBuilder";

export class CaptureChoiceBuilder extends ChoiceBuilder<ICaptureChoice> {
	constructor(
		app: App,
		choice: ICaptureChoice,
		plugin: ChoiceBuilderPlugin,
		onSave: (choice: IChoice) => void,
	) {
		super(app, choice, plugin, onSave, CaptureChoiceForm, "this capture choice's settings");
		this.containerEl.addClass("captureChoiceBuilder");
		this.normalizeChoice();
	}

	/**
	 * Fills in missing fields once, before mount: insertBefore and
	 * activeFileWritePosition always, fileOpening only when openFile is on.
	 */
	private normalizeChoice() {
		if (!this.choice.insertBefore) {
			this.choice.insertBefore = {
				enabled: false,
				before: "",
				createIfNotFound: false,
				createIfNotFoundLocation: CREATE_IF_NOT_FOUND_TOP,
			};
		}
		if (!this.choice.activeFileWritePosition) {
			this.choice.activeFileWritePosition = "cursor";
		}
		if (!this.choice.createFileIfItDoesntExist) {
			this.choice.createFileIfItDoesntExist = {
				enabled: false,
				createWithTemplate: false,
				template: "",
			};
		}
		if (
			!this.choice.captureToActiveFile &&
			!isCanvasTargetPath(this.choice.captureTo)
		) {
			this.choice.captureToCanvasNodeId = "";
		}
		if (this.choice.openFile) {
			this.choice.fileOpening = normalizeFileOpening(this.choice.fileOpening);
		}
		if (this.choice.propertyCapture) {
			this.choice.propertyCapture.sort ??= "none";
		}
	}
}
