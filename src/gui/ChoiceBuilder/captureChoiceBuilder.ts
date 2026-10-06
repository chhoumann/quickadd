import type { App } from "obsidian";
import { CREATE_IF_NOT_FOUND_TOP } from "../../constants";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type { Step } from "../../v3/model";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { normalizeFileOpening } from "../../utils/fileOpeningDefaults";
import { isCanvasTargetPath } from "./canvasNodes";
import CaptureChoiceForm from "./CaptureChoiceForm.svelte";
import { ChoiceBuilder } from "./choiceBuilder";

export class CaptureChoiceBuilder extends ChoiceBuilder<ICaptureChoice> {
	constructor(
		app: App,
		choice: ICaptureChoice,
		plugin: QuickAdd,
		onSave: (choice: IChoice) => void,
		onAddStep?: (step: Step) => void,
	) {
		super(app, choice, plugin, onSave, CaptureChoiceForm, "this capture choice's settings", onAddStep);
		this.containerEl.addClass("captureChoiceBuilder");
		this.normalizeChoice();
	}

	/**
	 * Apply the defaults the imperative builder set lazily inside render branches —
	 * once, before mount. addWritePositionSetting ran insertBefore/activeFileWritePosition
	 * defaults unconditionally on open, so they are hoisted; fileOpening is normalized
	 * only when openFile (parity with the gated addFileOpeningSetting).
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
	}
}
