import type IChoice from "./types/choices/IChoice";
import type ITemplateChoice from "./types/choices/ITemplateChoice";
import type ICaptureChoice from "./types/choices/ICaptureChoice";
import type { MacroAbortError } from "./errors/MacroAbortError";
import type { ChoiceOutcome } from "./types/ChoiceOutcome";
import type { FrontmatterPropertyTarget } from "./utils/frontmatterPropertyLinks";
import type { QuickAddTriggerContext } from "./types/QuickAddTriggerContext";

export interface IChoiceExecutor {
	execute(choice: IChoice): Promise<void>;
	/**
	 * Executes a choice while reusing context captured before an intermediate UI
	 * layer, such as a Multi-choice suggester, ran: the frontmatter property target
	 * (DOM focus is stolen by the suggester) and the trigger-time
	 * {@link QuickAddTriggerContext} (cleared when the outer Multi execute()
	 * returns). Both are re-injected so the eventual leaf run uses the original
	 * trigger note for `{{...|default-from:active}}`. Optional so existing stubs can
	 * fall back to {@link execute}; `triggerContext` is optional so callers that only
	 * carry a focused property need not pass it (the executor then reads it live).
	 */
	executeWithFocusedProperty?(
		choice: IChoice,
		focusedProperty: FrontmatterPropertyTarget | null,
		triggerContext?: QuickAddTriggerContext | null,
	): Promise<void>;
	/**
	 * Executes a Template/Capture choice and returns its structured outcome
	 * (success with the affected file, error, or cancelled) instead of the void
	 * {@link execute}. Callers that must report real success/failure — the URI
	 * x-callback handler and the `quickadd:run-template` CLI — use this so a
	 * swallowed engine failure can't masquerade as success. Optional so existing
	 * stubs remain valid.
	 */
	executeWithOutcome?(
		choice: ITemplateChoice | ICaptureChoice,
	): Promise<ChoiceOutcome>;
	variables: Map<string, unknown>;
	/**
	 * Whether this execution may open blocking interactive UI (suggesters/modals)
	 * for inputs the requirement collector cannot pre-satisfy — e.g. the
	 * "file already exists" prompt, the folder chooser, or the heading picker.
	 * Defaults to interactive (`true`/`undefined`) so GUI runs are unchanged.
	 * Non-interactive callers (the `quickadd:run`/`run-template` CLI without the
	 * `ui` flag, and any headless automation) set this to `false`; engines then
	 * abort such a prompt with a clear, actionable error instead of hanging forever
	 * on an unanswerable modal.
	 */
	interactive?: boolean;
	/**
	 * Frontmatter property value focused when the outermost choice execution began.
	 * Append Link uses this to avoid the stale CodeMirror cursor Obsidian reports
	 * while a Properties field owns focus.
	 */
	focusedProperty?: FrontmatterPropertyTarget | null;
	/**
	 * Snapshot of the editor context (currently just the active file) taken when
	 * the OUTERMOST choice execution began, before any QuickAdd UI opens or a
	 * Template choice creates/opens a new note. `{{FIELD:<field>|default-from:active}}`
	 * reads the active note's current property from this to default the prompt.
	 * Optional so existing stubs and the legacy void {@link execute} path are
	 * unaffected; absent/undefined means "no trigger-derived default".
	 */
	triggerContext?: QuickAddTriggerContext | null;
	/**
	 * Records the structured outcome of the current execution so an orchestrator
	 * (the URI x-callback handler, via {@link ChoiceExecutor.executeWithOutcome}) can
	 * report success/failure/cancel to an external caller. Optional — engines call it
	 * via `?.`, so existing stubs and the legacy void {@link execute} path are
	 * unaffected. Record `success` at the content-commit point, before any cosmetic
	 * step, so a later cosmetic failure cannot downgrade the outcome.
	 */
	recordExecutionResult?(result: ChoiceOutcome): void;
	/**
	 * Records that the most recent choice execution aborted so orchestrators can react.
	 * Engines that handle cancellations without throwing should call this immediately after
	 * {@link handleMacroAbort} returns true.
	 */
	signalAbort?(error: MacroAbortError): void;
	/**
	 * Returns and clears any pending abort signal. Callers should invoke this right after
	 * awaiting {@link execute} to determine whether the child choice stopped early.
	 */
	consumeAbortSignal?(): MacroAbortError | null;
	/**
	 * User-script modules already loaded (and therefore already EXECUTED - loading
	 * a CommonJS user script runs its top-level code) by a requirement-collection
	 * pass, keyed by `getUserScriptPreloadKey` (`command.path ?? command.id` plus
	 * any `::` member-drill suffix - stored values are DRILLED exports, so keying
	 * by path alone would collide different members of one file). MacroChoiceEngine
	 * consumes an entry (delete-on-use) instead of re-loading the script, so
	 * introspecting `quickadd.inputs` in the one-page preflight / non-interactive
	 * CLI does not make a script's top-level side effects run twice per trigger.
	 * Optional so existing stubs are unaffected; absent means "no preloaded
	 * modules".
	 */
	preloadedUserScripts?: Map<string, unknown>;
}
