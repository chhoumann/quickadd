import type { TFile } from "obsidian";

/**
 * The result of executing a single choice, surfaced by
 * {@link ChoiceExecutor.executeWithOutcome} for callers (e.g. the URI x-callback
 * handler) that must report success / failure / cancellation back to an external
 * caller.
 *
 * `success` carries the affected file when one is known (Template, Capture).
 * `cancelled` distinguishes a genuine user prompt-dismissal (`"user"`) from an
 * involuntary script/config abort (`"aborted"`). `error` means the choice failed.
 *
 * `reason` carries the message that explains the outcome — the abort reason ("needs
 * to ask … re-run with the ui flag") or the failure itself (`Template file not found
 * at path "templates/x.md"`). It is for a local, trusted caller: the CLI and the
 * interactive bridge, both loopback- and token-gated, surface it, because on those
 * paths nobody is looking at the desktop notice that carries the same text (#1603).
 * The URI x-callback handler deliberately ignores it on BOTH variants, reporting only
 * a fixed code, so no vault detail leaks to an external callback URL.
 */
export type ChoiceOutcome =
	| { status: "success"; file?: TFile }
	| { status: "error"; reason?: string }
	| { status: "cancelled"; cancelKind: "user" | "aborted"; reason?: string };
