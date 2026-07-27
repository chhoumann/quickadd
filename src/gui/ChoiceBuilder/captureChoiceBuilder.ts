import type { App } from "obsidian";
import { CREATE_IF_NOT_FOUND_TOP } from "../../constants";
import type QuickAdd from "../../main";
import type IChoice from "../../types/choices/IChoice";
import type ICaptureChoice from "../../types/choices/ICaptureChoice";
import { normalizeFileOpening } from "../../utils/fileOpeningDefaults";
import { mountComponent } from "../svelte/mountComponent";
import { isCanvasTargetPath } from "./canvasNodes";
import CaptureChoiceForm from "./CaptureChoiceForm.svelte";
import {
	createCaptureChoiceFormProps,
	type CaptureChoiceFormProps,
} from "./captureChoiceFormProps.svelte";
import { ChoiceBuilder } from "./choiceBuilder";

export class CaptureChoiceBuilder extends ChoiceBuilder {
	choice: ICaptureChoice;
	private formProps?: CaptureChoiceFormProps;

	constructor(
		app: App,
		choice: ICaptureChoice,
		private plugin: QuickAdd,
	) {
		super(app);
		this.choice = choice;
		this.normalizeChoice();
		this.display();
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

	protected display() {
		this.containerEl.addClass("captureChoiceBuilder");
		this.formProps = createCaptureChoiceFormProps({
			choice: this.choice,
			app: this.app,
			plugin: this.plugin,
		});
		const handle = mountComponent(
			this.contentEl,
			CaptureChoiceForm,
			this.formProps,
			{ what: "this capture choice's settings" },
		);
		// The form never rendered, so its $state clone of the choice holds no edits
		// — only whatever normalizeChoice() and $state.snapshot() made of it. Drop it
		// so onClose resolves the ORIGINAL choice and a form the user never saw can't
		// write itself back over their data (#1584).
		if (!handle.ok) this.formProps = undefined;
		this.svelteElements.push(handle);
	}

	protected getResultChoice(): IChoice {
		return this.formProps?.choice ?? this.choice;
	}
}
