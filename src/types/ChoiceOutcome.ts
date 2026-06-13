import type { TFile } from "obsidian";

/**
 * The result of executing a single choice, surfaced by
 * {@link ChoiceExecutor.executeWithOutcome} for callers (e.g. the URI x-callback
 * handler) that must report success / failure / cancellation back to an external
 * caller.
 *
 * `success` carries the affected file when one is known (Template, Capture).
 * `cancelled` distinguishes a genuine user prompt-dismissal (`"user"`) from an
 * involuntary script/config abort (`"aborted"`). `error` means the choice failed
 * (the detailed message is kept in the internal log, never surfaced externally).
 */
export type ChoiceOutcome =
	| { status: "success"; file?: TFile }
	| { status: "error" }
	| { status: "cancelled"; cancelKind: "user" | "aborted" };
