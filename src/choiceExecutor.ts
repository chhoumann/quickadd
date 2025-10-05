import type { App } from "obsidian";
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

export class ChoiceExecutor implements IChoiceExecutor {
	public variables: Map<string, unknown> = new Map<string, unknown>();

	constructor(
		private app: App,
		private plugin: QuickAdd
	) {}

	async execute(choice: IChoice): Promise<void> {
		// One-page preflight honoring per-choice override
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
					choice
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
				const templateChoice: ITemplateChoice = choice as ITemplateChoice;
				await this.onChooseTemplateType(templateChoice);
				break;
			}
			case "Capture": {
				const captureChoice: ICaptureChoice = choice as ICaptureChoice;
				await this.onChooseCaptureType(captureChoice);
				break;
			}
			case "Macro": {
				const macroChoice: IMacroChoice = choice as IMacroChoice;
				await this.onChooseMacroType(macroChoice);
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
	}

	private async onChooseTemplateType(
		templateChoice: ITemplateChoice
	): Promise<void> {
		await new TemplateChoiceEngine(
			this.app,
			this.plugin,
			templateChoice,
			this
		).run();
	}

	private async onChooseCaptureType(captureChoice: ICaptureChoice) {
		await new CaptureChoiceEngine(
			this.app,
			this.plugin,
			captureChoice,
			this
		).run();
	}

	private async onChooseMacroType(macroChoice: IMacroChoice) {
		const macroEngine = new MacroChoiceEngine(
			this.app,
			this.plugin,
			macroChoice,
			this,
			this.variables
		);
		await macroEngine.run();

		Object.entries(macroEngine.params.variables).forEach(([key, value]) => {
			this.variables.set(key, value as string);
		});
	}

	private onChooseMultiType(multiChoice: IMultiChoice) {
		ChoiceSuggester.Open(this.plugin, multiChoice.choices, this);
	}
}
