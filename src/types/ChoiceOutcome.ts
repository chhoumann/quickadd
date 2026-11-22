import type { TFile } from "obsidian";

/**
 * What a successful run did to the file it aimed at, judged on persisted bytes,
 * not the payload. `success` alone only says the run finished, while an empty
 * Capture payload or a Keep-existing Template is a no-op that an automation
 * must tell apart. `created`: the target did not exist; `changed`: its bytes
 * differ; `unchanged`: byte-identical. Other steps (append link, clipboard) are
 * not described here.
 */
export type ChoiceEffect = "created" | "changed" | "unchanged";

/**
 * The result of executing one choice, for callers that report to an external
 * caller. `cancelled` separates a user dismissal (`"user"`) from an involuntary
 * abort (`"aborted"`). `reason` explains the outcome for local, token-gated
 * callers (CLI, interactive bridge); the URI x-callback handler sends only a
 * fixed code so no vault detail leaks. `effect` carries no vault detail, so it
 * is sent.
 */
export type ChoiceOutcome =
	| { status: "success"; file?: TFile; effect: ChoiceEffect }
	| { status: "error"; reason?: string }
	| { status: "cancelled"; cancelKind: "user" | "aborted"; reason?: string };
