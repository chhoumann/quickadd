import type { TFile } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { ChoiceEffect } from "../types/ChoiceOutcome";
import { InputPromptDraftStore } from "../utils/InputPromptDraftStore";
import { log } from "../logger/logManager";

/**
 * Records what a choice run actually did, for callers reporting to someone who
 * is not looking at the Obsidian window. Every failure exit carries its reason,
 * the same text as the desktop notice. The failure recorder is a no-op once the
 * run has committed, so a later append-link or open-file failure cannot make
 * automation retry and duplicate side effects. That holds for an `unchanged` run
 * too, since its later steps still write elsewhere.
 */
export class ChoiceOutcomeRecorder {
	/**
	 * The outcome is settled — {@link failure} can no longer overwrite it. Distinct from
	 * the {@link ChoiceEffect} the run reports: `closed` is about this recorder's state,
	 * `effect` is about the vault.
	 */
	private closed = false;

	constructor(
		private readonly executor: Pick<IChoiceExecutor, "recordExecutionResult">,
	) {}

	/**
	 * The run reached its commit point. `effect` is required rather than
	 * defaulted, so every call site states its claim about the vault.
	 */
	success(file: TFile | undefined, effect: ChoiceEffect): void {
		this.closed = true;
		this.executor.recordExecutionResult?.({ status: "success", file, effect });
	}

	/**
	 * The run failed, with the message that explains why - the same text the desktop
	 * notice carries, so a remote client and a local user learn the same thing.
	 */
	failure(reason: string): void {
		if (this.closed) return;
		this.executor.recordExecutionResult?.({ status: "error", reason });
	}

	/**
	 * A failure exit that is not a throw: keep the run's prompt drafts, log the
	 * message for the desktop, and record it as the outcome. `"none"` is for a
	 * failure a lower layer already reported, so it is not shown twice.
	 */
	fail(message: string, level: "error" | "warning" | "none" = "error"): void {
		InputPromptDraftStore.getInstance().markExecutionScopeFailed();
		if (level === "warning") log.logWarning(message);
		else if (level === "error") log.logError(message);
		this.failure(message);
	}
}

/** The message to report for a caught value, without any context prefix. */
export function failureReason(error: unknown): string {
	// Never yields "": an empty reason reads to a client as "no reason given", which is
	// the state this whole seam exists to remove.
	if (error instanceof Error) return error.message || FALLBACK_REASON;
	return String(error) || FALLBACK_REASON;
}

const FALLBACK_REASON = "Choice execution failed.";
