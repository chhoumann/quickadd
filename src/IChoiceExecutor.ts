import type IChoice from "./types/choices/IChoice";
import type { MacroAbortError } from "./errors/MacroAbortError";

export interface IChoiceExecutor {
	execute(choice: IChoice): Promise<void>;
	variables: Map<string, unknown>;
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
