import { Notice, type App, type WorkspaceLeaf } from "obsidian";
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
import { UserCancelError } from "./errors/UserCancelError";
import { isCancellationError, reportError } from "./utils/errorUtils";
import { getOpenFileOriginLeaf } from "./utilityObsidian";
import { InputPromptDraftStore } from "./utils/InputPromptDraftStore";
import type { ChoiceOutcome } from "./types/ChoiceOutcome";
import {
	getFocusedPropertyTarget,
	type FrontmatterPropertyTarget,
} from "./utils/frontmatterPropertyLinks";
import type { QuickAddTriggerContext } from "./types/QuickAddTriggerContext";

export class ChoiceExecutor implements IChoiceExecutor {
	public variables: Map<string, unknown> = new Map<string, unknown>();
	// Default to interactive so every GUI entry point (command palette, ribbon,
	// suggester) keeps its current prompt behaviour. Non-interactive callers (CLI
	// without `ui`) flip this to false so engine prompts abort instead of hanging.
	public interactive = true;
	// User-script modules loaded by requirement collection (preflight / CLI),
	// consumed once by MacroChoiceEngine so a script's top-level code runs a
	// single time per trigger instead of once for introspection plus once for
	// execution (see IChoiceExecutor.preloadedUserScripts).
	public readonly preloadedUserScripts = new Map<string, unknown>();
	public focusedProperty: FrontmatterPropertyTarget | null = null;
	public triggerContext: QuickAddTriggerContext | null = null;
	private pendingAbort: MacroAbortError | null = null;
	private pendingResult: ChoiceOutcome | null = null;
	private executionDepth = 0;
	private focusedPropertyOverride: FrontmatterPropertyTarget | null | undefined;
	private triggerContextOverride: QuickAddTriggerContext | null | undefined;

	constructor(private app: App, private plugin: QuickAdd) {}

	signalAbort(error: MacroAbortError) {
		this.pendingAbort = error;
	}

	consumeAbortSignal(): MacroAbortError | null {
		const abort = this.pendingAbort;
		this.pendingAbort = null;
		return abort ?? null;
	}

	recordExecutionResult(result: ChoiceOutcome) {
		this.pendingResult = result;
	}

	private beginExecutionContext(): void {
		if (this.executionDepth === 0) {
			this.focusedProperty =
				this.focusedPropertyOverride !== undefined
					? this.focusedPropertyOverride
					: getFocusedPropertyTarget(this.app);
			// Snapshot the trigger-time editor context at the outermost boundary, so a
			// nested execute() (a {{MACRO}} that opens a file then runs a FIELD
			// template, or the API path) keeps the ORIGINAL trigger note as the source
			// for {{...|default-from:active}}, mirroring focusedProperty's depth-0
			// semantics. The Multi path opens a nested suggester and lets the outer
			// execute() return (clearing this at depth 0), so — like focusedProperty —
			// the captured context is threaded through the suggester and re-injected as
			// triggerContextOverride for the chosen leaf's own depth-0 run, instead of a
			// live re-read at leaf time. A direct execute() (command palette/ribbon) has
			// no override and reads live, which is the trigger note (the active markdown
			// leaf is unchanged by the launching modal).
			this.triggerContext =
				this.triggerContextOverride !== undefined
					? this.triggerContextOverride
					: { activeFile: this.app.workspace.getActiveFile() };
		}
		this.executionDepth++;
	}

	private endExecutionContext(): void {
		this.executionDepth = Math.max(0, this.executionDepth - 1);
		if (this.executionDepth === 0) {
			this.focusedProperty = null;
			this.triggerContext = null;
		}
	}

	async execute(choice: IChoice): Promise<void> {
		this.pendingAbort = null;
		// Keep a nested execute() (e.g. a {{MACRO}} in a Template/Capture body that runs
		// another choice through this same executor) transparent to the outcome slot of an
		// enclosing executeWithOutcome(): snapshot and restore pendingResult so the nested
		// choice's recorded result never leaks into the outer choice's reported outcome.
		const savedResult = this.pendingResult;
		this.beginExecutionContext();
		const originLeaf = getOpenFileOriginLeaf(this.app);
		const promptDraftStore = InputPromptDraftStore.getInstance();
		promptDraftStore.beginExecutionScope();
		try {
			await this.runOnePagePreflightIfEnabled(choice);

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
		} finally {
			this.pendingResult = savedResult;
			this.endExecutionContext();
		}
	}

	async executeWithFocusedProperty(
		choice: IChoice,
		focusedProperty: FrontmatterPropertyTarget | null,
		triggerContext?: QuickAddTriggerContext | null,
	): Promise<void> {
		const previousFocusedOverride = this.focusedPropertyOverride;
		const previousTriggerOverride = this.triggerContextOverride;
		this.focusedPropertyOverride = focusedProperty;
		// `triggerContext` is `undefined` only when the caller didn't capture one;
		// leave the override unset so the executor reads it live. A captured value
		// (including `null` for "no active note at trigger time") IS injected.
		this.triggerContextOverride = triggerContext;
		try {
			await this.execute(choice);
		} finally {
			this.focusedPropertyOverride = previousFocusedOverride;
			this.triggerContextOverride = previousTriggerOverride;
		}
	}

	/**
	 * Executes a Template or Capture choice and returns a structured
	 * {@link ChoiceOutcome} (used by the URI x-callback handler). Mirrors
	 * {@link execute}'s envelope (one-page preflight + prompt-draft scope) so behaviour
	 * is identical to the legacy void path; the only addition is surfacing the outcome.
	 *
	 * Nesting-safe: Template/Capture never run nested choices through this executor, so
	 * the single result slot cannot be clobbered. An engine that completed without
	 * recording success (and without aborting/throwing) hit a swallowed-failure branch,
	 * which is reported as `error` — never silently as success.
	 */
	async executeWithOutcome(
		choice: ITemplateChoice | ICaptureChoice,
	): Promise<ChoiceOutcome> {
		this.pendingAbort = null;
		this.pendingResult = null;
		this.beginExecutionContext();
		const originLeaf = getOpenFileOriginLeaf(this.app);
		const promptDraftStore = InputPromptDraftStore.getInstance();
		promptDraftStore.beginExecutionScope();
		try {
			await this.runOnePagePreflightIfEnabled(choice);

			if (choice.type === "Template") {
				await this.onChooseTemplateType(choice as ITemplateChoice, originLeaf);
			} else {
				await this.onChooseCaptureType(choice as ICaptureChoice, originLeaf);
			}

			if (this.pendingAbort) {
				promptDraftStore.rollbackExecutionScope();
				const abort = this.consumeAbortSignal();
				const isUser = abort instanceof UserCancelError;
				return {
					status: "cancelled",
					cancelKind: isUser ? "user" : "aborted",
					// Only surface the message for an involuntary abort (e.g. the
					// non-interactive prompt guards). A user dismissal keeps its stable
					// "cancelled by user" text and leaks no internals.
					reason: isUser ? undefined : abort?.message,
				};
			}

			promptDraftStore.commitExecutionScope();
			const result = this.pendingResult;
			this.pendingResult = null;
			// No success recorded and no abort => the engine swallowed a failure.
			return result ?? { status: "error" };
		} catch (error) {
			promptDraftStore.rollbackExecutionScope();
			if (error instanceof UserCancelError) {
				// Stable user-facing text; no internal message surfaced.
				return { status: "cancelled", cancelKind: "user" };
			}
			if (error instanceof MacroAbortError) {
				return { status: "cancelled", cancelKind: "aborted", reason: error.message };
			}
			reportError(error, "Error executing choice from URI");
			return { status: "error" };
		} finally {
			this.endExecutionContext();
		}
	}

	private async runOnePagePreflightIfEnabled(choice: IChoice): Promise<void> {
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
					throw new UserCancelError("One-page input cancelled by user");
				}
				throw error;
			}
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
			this.preloadedUserScripts,
			undefined,
			originLeaf,
		);
		await macroEngine.run();

		Object.entries(macroEngine.params.variables).forEach(([key, value]) => {
			this.variables.set(key, value as string);
		});
	}

	private onChooseMultiType(multiChoice: IMultiChoice) {
		// An empty folder run via command/URI would otherwise open a dead, item-less
		// picker (no Back row is appended on this path) that reads as a broken command.
		// Surface a Notice instead so the user knows the folder simply has nothing in it.
		if (multiChoice.choices.length === 0) {
			new Notice(`Folder "${multiChoice.name}" is empty.`);
			return;
		}

		ChoiceSuggester.Open(this.plugin, multiChoice.choices, {
			choiceExecutor: this,
			focusedProperty: this.focusedProperty,
			triggerContext: this.triggerContext,
			// Fall back to the folder name when no custom placeholder is set, matching the
			// picker drill-down (choiceSuggester.onChooseMultiType) so both entry points to
			// the same folder show the same search hint.
			placeholder: multiChoice.placeholder?.trim() || multiChoice.name,
		});
	}
}
