import type IChoice from "./types/choices/IChoice";
import type ITemplateChoice from "./types/choices/ITemplateChoice";
import type ICaptureChoice from "./types/choices/ICaptureChoice";
import type { MacroAbortError } from "./errors/MacroAbortError";
import type { ChoiceOutcome } from "./types/ChoiceOutcome";
import type { FrontmatterPropertyTarget } from "./utils/frontmatterPropertyLinks";
import type { CallerDay, RunClocks } from "./types/dateOrigin";
import type { QuickAddTriggerContext } from "./types/QuickAddTriggerContext";
import type { PromptProvider } from "./interactive/promptProvider";
import type IMacroChoice from "./types/choices/IMacroChoice";
import type { ICommand } from "./types/macros/ICommand";
import type { PreparedChoiceInputState } from "./preflight/preparedChoiceInputs";
import type { LoadedUserScript } from "./utils/userScript";
import type { ChoiceChain } from "./engine/choiceChain";

export interface RunChoiceOptions {
	/** The chain of the run that starts this one, as for {@link IChoiceExecutor.execute}. */
	ancestry?: ChoiceChain;
	/** Trigger context for an outermost run whose caller named none. */
	triggerContext?: QuickAddTriggerContext;
}

export interface IChoiceExecutor {
	/**
	 * Runs `work` as a run of `choice`: one-page inputs, Which day, clocks,
	 * trigger context and prompt-draft scope. Anything that acts on behalf of a
	 * choice starts here rather than building an engine, or those settings are
	 * skipped.
	 */
	runChoice<T>(
		choice: IChoice,
		work: (chain: ChoiceChain) => Promise<T>,
		options?: RunChoiceOptions,
	): Promise<T>;
	/** Fails with the cycle when `choice` is already in `ancestry`. */
	execute(choice: IChoice, ancestry?: ChoiceChain): Promise<void>;
	prepareMacroInputs(choice: IMacroChoice, commands: ICommand[]): Promise<void>;
	readonly preparedInputs: PreparedChoiceInputState;
	/**
	 * Executes a choice with context captured before an intermediate UI (such as
	 * a Multi suggester) stole focus or the outer run cleared it, so the leaf run
	 * still sees the original property target and trigger note.
	 */
	executeWithFocusedProperty?(
		choice: IChoice,
		focusedProperty: FrontmatterPropertyTarget | null,
		triggerContext?: QuickAddTriggerContext | null,
		ancestry?: ChoiceChain,
	): Promise<void>;
	/**
	 * Like {@link execute}, but returns the structured outcome so callers that
	 * report to an external caller cannot mistake a swallowed failure for success.
	 */
	executeWithOutcome?(
		choice: ITemplateChoice | ICaptureChoice,
	): Promise<ChoiceOutcome>;
	variables: Map<string, unknown>;
	/** Frozen wall clock and optional calendar origin for this outermost run. */
	clocks?: RunClocks;
	/**
	 * Overrides the Which day of the next choice that resolves one: `"pick"`
	 * asks even when it is set to Today. Choices it runs inherit the result.
	 */
	callerDay?: CallerDay;
	/**
	 * Sets {@link clocks} from the choice's Which day setting, asking when it is
	 * Ask each time.
	 */
	resolveDateOrigin?(choice: IChoice): Promise<void>;
	/**
	 * False for headless callers: engines then fail a prompt the requirement
	 * collector could not pre-satisfy instead of hanging on an unanswerable modal.
	 */
	interactive?: boolean;
	/**
	 * Routes runtime script prompts to a remote front end instead of an Obsidian
	 * modal. Independent of {@link interactive}.
	 */
	promptProvider?: PromptProvider;
	/**
	 * Property focused when the outermost run began. Obsidian reports a stale
	 * CodeMirror cursor while a Properties field owns focus.
	 */
	focusedProperty?: FrontmatterPropertyTarget | null;
	/**
	 * Active file captured when the outermost run began, before any QuickAdd UI
	 * or a newly created note changes it. Backs `|default-from:active`.
	 */
	triggerContext?: QuickAddTriggerContext | null;
	/**
	 * Record `success` at the content-commit point, before any cosmetic step, so
	 * a later cosmetic failure cannot downgrade the outcome.
	 */
	recordExecutionResult?(result: ChoiceOutcome): void;
	/**
	 * Engines that handle a cancellation without throwing call this right after
	 * {@link handleMacroAbort} returns true.
	 */
	signalAbort?(error: MacroAbortError): void;
	/** Returns and clears the pending abort signal; call right after awaiting {@link execute}. */
	consumeAbortSignal?(): MacroAbortError | null;
	/**
	 * User scripts already loaded, and therefore already executed, by a
	 * requirement-collection pass, keyed by `getUserScriptPreloadKey`. The macro
	 * engine consumes an entry instead of reloading, so top-level side effects
	 * run once per trigger.
	 */
	preloadedUserScripts?: Map<string, LoadedUserScript>;
}
