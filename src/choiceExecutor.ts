import type { App, WorkspaceLeaf } from "obsidian";
import type QuickAdd from "./main";
import type IChoice from "./types/choices/IChoice";
import type ITemplateChoice from "./types/choices/ITemplateChoice";
import type ICaptureChoice from "./types/choices/ICaptureChoice";
import type IMacroChoice from "./types/choices/IMacroChoice";
import { TemplateChoiceEngine } from "./engine/TemplateChoiceEngine";
import { CaptureChoiceEngine } from "./engine/CaptureChoiceEngine";
import { MacroChoiceEngine } from "./engine/MacroChoiceEngine";
import type { IChoiceExecutor } from "./IChoiceExecutor";
import type IMultiChoice from "./types/choices/IMultiChoice";
import ChoiceSuggester from "./gui/suggesters/choiceSuggester";
import { settingsStore } from "./settingsStore";
import { runOnePagePreflight } from "./preflight/runOnePagePreflight";
import { MacroAbortError } from "./errors/MacroAbortError";
import { isCancellationError } from "./utils/errorUtils";
import {
	getFocusedPropertyTarget,
	getOpenFileOriginLeaf,
	type FrontmatterPropertyTarget,
} from "./utilityObsidian";
import { InputPromptDraftStore } from "./utils/InputPromptDraftStore";

export class ChoiceExecutor implements IChoiceExecutor {
	public variables: Map<string, unknown> = new Map<string, unknown>();
	public focusedProperty: FrontmatterPropertyTarget | null = null;
	private focusCaptured = false;
	private pendingAbort: MacroAbortError | null = null;

	constructor(private app: App, private plugin: QuickAdd) {}

	signalAbort(error: MacroAbortError) {
		this.pendingAbort = error;
	}

	consumeAbortSignal(): MacroAbortError | null {
		const abort = this.pendingAbort;
		this.pendingAbort = null;
		return abort ?? null;
	}

	async execute(choice: IChoice): Promise<void> {
		this.pendingAbort = null;
		// Capture the focused frontmatter property BEFORE any prompt/suggester
		// steals focus, so Append Link can target it later (#768). Captured once per
		// execution chain so nested Multi choices keep the original caret.
		if (!this.focusCaptured) {
			this.focusCaptured = true;
			this.focusedProperty = getFocusedPropertyTarget(this.app);
		}
		const originLeaf = getOpenFileOriginLeaf(this.app);
		const promptDraftStore = InputPromptDraftStore.getInstance();
		promptDraftStore.beginExecutionScope();
		try {
			// One-page preflight honoring per-choice override.
			const globalEnabled = settingsStore.getState().onePageInputEnabled;
			const override = choice.onePageInput;
			const shouldUseOnePager =
				override === "always" || (override !== "never" && globalEnabled);
			if (
				shouldUseOnePager &&
				(choice.type === "Template" ||
					choice.type === "Capture" ||
					choice.type === "Macro")
			) {
				try {
					await runOnePagePreflight(
						this.app,
						this.plugin as unknown as QuickAdd,
						this,
						choice,
					);
				} catch (error) {
					if (isCancellationError(error)) {
						throw new MacroAbortError("One-page input cancelled by user");
					}
					throw error;
				}
			}

			switch (choice.type) {
				case "Template": {
					const templateChoice: ITemplateChoice =
						choice as ITemplateChoice;
					await this.onChooseTemplateType(templateChoice, originLeaf);
					break;
				}
				case "Capture": {
					const captureChoice: ICaptureChoice = choice as ICaptureChoice;
					await this.onChooseCaptureType(captureChoice, originLeaf);
					break;
				}
				case "Macro": {
					const macroChoice: IMacroChoice = choice as IMacroChoice;
					await this.onChooseMacroType(macroChoice, originLeaf);
					break;
				}
				case "Multi": {
					const multiChoice: IMultiChoice = choice as IMultiChoice;
					this.onChooseMultiType(multiChoice);
					break;
				}
				default:
					break;
			}

			if (this.pendingAbort) {
				promptDraftStore.rollbackExecutionScope();
				return;
			}

			promptDraftStore.commitExecutionScope();
		} catch (error) {
			promptDraftStore.rollbackExecutionScope();
			throw error;
		}
	}

	private async onChooseTemplateType(
		templateChoice: ITemplateChoice,
		originLeaf: WorkspaceLeaf | null,
	): Promise<void> {
		await new TemplateChoiceEngine(
			this.app,
			this.plugin,
			templateChoice,
			this,
			originLeaf,
		).run();
	}

	private async onChooseCaptureType(
		captureChoice: ICaptureChoice,
		originLeaf: WorkspaceLeaf | null,
	) {
		await new CaptureChoiceEngine(
			this.app,
			this.plugin,
			captureChoice,
			this,
			originLeaf,
		).run();
	}

	private async onChooseMacroType(
		macroChoice: IMacroChoice,
		originLeaf: WorkspaceLeaf | null,
	) {
		const macroEngine = new MacroChoiceEngine(
			this.app,
			this.plugin,
			macroChoice,
			this,
			this.variables,
			undefined,
			undefined,
			originLeaf,
		);
		await macroEngine.run();

		Object.entries(macroEngine.params.variables).forEach(([key, value]) => {
			this.variables.set(key, value as string);
		});
	}

	private onChooseMultiType(multiChoice: IMultiChoice) {
		ChoiceSuggester.Open(this.plugin, multiChoice.choices, {
			choiceExecutor: this,
			placeholder: multiChoice.placeholder,
		});
	}
}
