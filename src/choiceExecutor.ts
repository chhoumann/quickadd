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
import { getOpenFileOriginLeaf } from "./utilityObsidian";
import {
	createChoiceExecutionContext,
	createChoiceExecutionResult,
	type ChoiceExecutionContext,
	type ChoiceExecutionResult,
} from "./engine/runtime";
import { getIntegrationRegistry } from "./integrations/IntegrationRegistry";

export class ChoiceExecutor implements IChoiceExecutor {
	public variables: Map<string, unknown> = new Map<string, unknown>();
	private pendingAbort: MacroAbortError | null = null;
	private executionContext: ChoiceExecutionContext | null = null;
	private executionDepth = 0;

	constructor(private app: App, private plugin: QuickAdd) {}

	signalAbort(error: MacroAbortError) {
		this.pendingAbort = error;
	}

	consumeAbortSignal(): MacroAbortError | null {
		const abort = this.pendingAbort;
		this.pendingAbort = null;
		return abort ?? null;
	}

	getExecutionContext(): ChoiceExecutionContext | null {
		return this.executionContext;
	}

	async execute(choice: IChoice): Promise<ChoiceExecutionResult> {
		const isRootExecution = this.executionDepth === 0 || !this.executionContext;
		if (isRootExecution) {
			this.pendingAbort = null;
			this.executionContext = this.createRootContext(choice);
			this.variables = this.executionContext.variables;
		} else {
			this.pendingAbort = null;
		}

		this.executionDepth++;

		try {
			await this.runOnePagePreflightIfEnabled(choice);

			const result = await this.executeChoiceByType(choice);
			const abort = this.pendingAbort;
			if (abort) {
				return this.createResult(choice, "aborted", abort);
			}

			return result;
		} catch (error) {
			if (error instanceof MacroAbortError) {
				this.signalAbort(error);
				return this.createResult(choice, "aborted", error);
			}

			throw error;
		} finally {
			this.executionDepth--;
			if (isRootExecution) {
				this.executionContext = null;
				this.executionDepth = 0;
			}
		}
	}

	private createRootContext(choice: IChoice): ChoiceExecutionContext {
		return createChoiceExecutionContext({
			rootChoiceId: choice.id,
			originLeaf: getOpenFileOriginLeaf(this.app),
			variables: this.variables,
			integrations: getIntegrationRegistry(this.app),
		});
	}

	private async runOnePagePreflightIfEnabled(choice: IChoice): Promise<void> {
		const globalEnabled = settingsStore.getState().onePageInputEnabled;
		const override = choice.onePageInput;
		const shouldUseOnePager =
			override === "always" || (override !== "never" && globalEnabled);
		if (
			!shouldUseOnePager ||
			(choice.type !== "Template" &&
				choice.type !== "Capture" &&
				choice.type !== "Macro")
		) {
			return;
		}

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

	private async executeChoiceByType(
		choice: IChoice,
	): Promise<ChoiceExecutionResult> {
		switch (choice.type) {
			case "Template":
				return await this.onChooseTemplateType(choice as ITemplateChoice);
			case "Capture":
				return await this.onChooseCaptureType(choice as ICaptureChoice);
			case "Macro":
				return await this.onChooseMacroType(choice as IMacroChoice);
			case "Multi":
				this.onChooseMultiType(choice as IMultiChoice);
				return this.createResult(choice, "success");
			default:
				return this.createResult(choice, "skipped");
		}
	}

	private async onChooseTemplateType(
		templateChoice: ITemplateChoice,
	): Promise<ChoiceExecutionResult> {
		await new TemplateChoiceEngine(
			this.app,
			this.plugin,
			templateChoice,
			this,
			this.getOriginLeaf(),
			this.executionContext ?? undefined,
		).run();
		return this.createResult(templateChoice, "success");
	}

	private async onChooseCaptureType(
		captureChoice: ICaptureChoice,
	): Promise<ChoiceExecutionResult> {
		await new CaptureChoiceEngine(
			this.app,
			this.plugin,
			captureChoice,
			this,
			this.getOriginLeaf(),
			this.executionContext ?? undefined,
		).run();
		return this.createResult(captureChoice, "success");
	}

	private async onChooseMacroType(
		macroChoice: IMacroChoice,
	): Promise<ChoiceExecutionResult> {
		const macroEngine = new MacroChoiceEngine(
			this.app,
			this.plugin,
			macroChoice,
			this,
			this.variables,
			undefined,
			undefined,
			this.getOriginLeaf(),
		);
		const result = await macroEngine.run();

		Object.entries(macroEngine.params.variables).forEach(([key, value]) => {
			this.variables.set(key, value as string);
		});

		return result;
	}

	private onChooseMultiType(multiChoice: IMultiChoice) {
		ChoiceSuggester.Open(this.plugin, multiChoice.choices, {
			choiceExecutor: this,
			placeholder: multiChoice.placeholder,
		});
	}

	private getOriginLeaf(): WorkspaceLeaf | null {
		return this.executionContext?.originLeaf ?? null;
	}

	private createResult(
		choice: IChoice,
		status: ChoiceExecutionResult["status"],
		error?: unknown,
	): ChoiceExecutionResult {
		return createChoiceExecutionResult({
			status,
			choiceId: choice.id,
			stepId: this.executionContext?.createStepId(choice.type),
			artifacts: this.executionContext?.artifacts ?? [],
			diagnostics: this.executionContext?.diagnostics ?? [],
			error,
		});
	}
}
