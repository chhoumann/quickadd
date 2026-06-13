import type IChoice from "./types/choices/IChoice";
import type ITemplateChoice from "./types/choices/ITemplateChoice";
import type ICaptureChoice from "./types/choices/ICaptureChoice";
import type { MacroAbortError } from "./errors/MacroAbortError";
import type { ChoiceOutcome } from "./types/ChoiceOutcome";

export interface IChoiceExecutor {
	execute(choice: IChoice): Promise<void>;
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
}
