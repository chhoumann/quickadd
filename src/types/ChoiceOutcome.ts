import type { TFile } from "obsidian";

/**
 * What a successful run did to the file it was aiming at.
 *
 * Scoped to the choice's TARGET, not to the whole vault: a run can also append a link
 * to another note or copy one to the clipboard, and those steps are not described here.
 * "Did the capture land / was the note created" is the question an automation asks, and
 * it is the one this answers.
 *
 * `success` alone answers "did the run finish?", which is not the question an
 * automation asks — it asks "did anything land?". Those came apart in two shipped
 * configurations that need no interactivity at all: a Capture whose formatted payload
 * is empty deliberately leaves the file untouched (inserting would add a blank line
 * or, on `currentLine`, DELETE the selection), and a Template set to "Do nothing" when
 * the file exists is, by name, a no-op. Both reported an unqualified success, so a
 * caller counting captures or writing an idempotency marker recorded work that never
 * happened (#1615).
 *
 * `created` means the target did not exist before this run. `changed` means its bytes
 * differ. `unchanged` means the target is byte-identical — nothing failed, and the
 * capture or template simply had nothing to write.
 *
 * The claim is about PERSISTED BYTES, never about the payload: a Capture with an empty
 * payload can still legitimately `create` a note (create-if-not-found, possibly with a
 * rendered template body), and one whose payload is non-empty can still leave the file
 * untouched. Deriving this from the formatted content instead of the file would just
 * relocate the lie.
 */
export type ChoiceEffect = "created" | "changed" | "unchanged";

/**
 * The result of executing a single choice, surfaced by
 * {@link ChoiceExecutor.executeWithOutcome} for callers (e.g. the URI x-callback
 * handler) that must report success / failure / cancellation back to an external
 * caller.
 *
 * `success` carries the affected file when one is known (Template, Capture) and the
 * {@link ChoiceEffect} it had on the vault.
 * `cancelled` distinguishes a genuine user prompt-dismissal (`"user"`) from an
 * involuntary script/config abort (`"aborted"`). `error` means the choice failed.
 *
 * `reason` carries the message that explains the outcome — the abort reason ("needs
 * to ask … re-run with the ui flag") or the failure itself (`Template file not found
 * at path "templates/x.md"`). It is for a local, trusted caller: the CLI and the
 * interactive bridge, both loopback- and token-gated, surface it, because on those
 * paths nobody is looking at the desktop notice that carries the same text (#1603).
 * The URI x-callback handler deliberately ignores it on BOTH variants, reporting only
 * a fixed code, so no vault detail leaks to an external callback URL. `effect` is not
 * subject to that rule: it is a three-token enum with no vault detail in it, and the
 * handler already sends the note's path, so withholding it would leave the very
 * automation #1615 is about still counting captures that never happened.
 */
export type ChoiceOutcome =
	| { status: "success"; file?: TFile; effect: ChoiceEffect }
	| { status: "error"; reason?: string }
	| { status: "cancelled"; cancelKind: "user" | "aborted"; reason?: string };
