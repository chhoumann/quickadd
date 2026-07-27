import type { TFile } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type { ChoiceEffect } from "../types/ChoiceOutcome";

/**
 * Records what a choice run actually did, for the callers that must report it back to
 * someone who is not looking at the Obsidian window.
 *
 * The Template and Capture engines report a failure with `reportError` - a desktop
 * notice - and then return without recording anything. `executeWithOutcome` reads that
 * as `{status:"error"}` with no reason, and the CLI substitutes a fixed sentence, so a
 * remote run of a Template whose template file is missing told its client
 * `"Choice execution failed; no file was created."` while the actionable message
 * (`Template file not found at path "templates/x.md"`) went to a notice nobody was
 * looking at (#1603). The whole premise of that seam is that nobody is at the desktop.
 *
 * Two rules:
 *
 * - **Every failure exit carries its reason.** Not just the top-level catch: the engines
 *   have five other places that log and return, and each one used to produce the same
 *   reason-less outcome. Routing them all through {@link failure} is what makes the CLI's
 *   fixed sentence unreachable rather than merely less common.
 * - **The failure recorder is a no-op once the run has left a side effect.** Both engines
 *   record success at their commit point precisely so a later append-link or open-file
 *   failure cannot make an automation caller retry and duplicate the side effect. That has
 *   to be a property of the recorder, not of one method: Capture commits from two places
 *   (the note path and the canvas path), and the canvas path keeps going into link and
 *   open-file steps whose throws unwind into `run()`'s catch.
 *
 *   That holds for an `unchanged` run too, even though it wrote nothing to its TARGET.
 *   The run is not over at the commit point: it goes on to the append-link step, which
 *   writes to a DIFFERENT note, and to the copy-link-to-clipboard step. So "nothing was
 *   duplicable" is false, and letting a later failure overwrite the recorded success
 *   would put the caller right back to retrying a run that already had side effects.
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
	 * The run reached its commit point. Records success with what it did to the vault.
	 *
	 * `effect` is required rather than defaulted: every call site has to state its claim,
	 * so a new one cannot inherit a positive "something landed" by omission. The four
	 * existing sites split evenly — two of them (Template's "Do nothing" mode and its
	 * open-an-existing-note discovery path) commit nothing at all.
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
}

/** The message to report for a caught value, without any context prefix. */
export function failureReason(error: unknown): string {
	// Never yields "": an empty reason reads to a client as "no reason given", which is
	// the state this whole seam exists to remove.
	if (error instanceof Error) return error.message || FALLBACK_REASON;
	return String(error) || FALLBACK_REASON;
}

const FALLBACK_REASON = "Choice execution failed.";
