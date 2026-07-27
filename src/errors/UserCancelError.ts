import { MacroAbortError } from "./MacroAbortError";

/**
 * Thrown when execution stops because the user dismissed a prompt (Escape / Cancel),
 * as opposed to a script- or config-initiated abort (`params.abort(...)`, a missing
 * target file, etc.).
 *
 * Extends {@link MacroAbortError} so every existing `instanceof MacroAbortError` guard
 * and abort-handling path keeps treating it as an abort. The distinct subclass lets the
 * URI x-callback handler classify a genuine user cancellation (`x-cancel`) apart from an
 * involuntary abort (`x-error`).
 *
 * Keeps `name = "MacroAbortError"` (inherited) so duck-typed checks that match on the
 * error name continue to recognise it.
 */
export class UserCancelError extends MacroAbortError {}

/**
 * The one message every prompt uses when the user dismisses it. Matches the text the
 * public docs promise (`MacroAbortError("Input cancelled by user")`), so a script that
 * surfaces `error.message` reads the same whether the prompt was dismissed in the app,
 * dismissed remotely, or converted from a legacy sentinel on the way up.
 */
export const PROMPT_CANCELLED_MESSAGE = "Input cancelled by user";

/**
 * The cancellation a prompt throws when the user dismisses it (Escape / Cancel / close).
 *
 * Prompts used to reject with a bare English sentence, recognised by exact string
 * equality (see the legacy sentinel list in `errorUtils`) — so rewording one, or
 * adding a prompt with a slightly different
 * sentence, silently turned "the user cancelled" into "an error occurred" with no compiler
 * or test signal (#1577). This is the typed replacement, and it is deliberately the SAME
 * class the ~40 consumers already converted that string into, rather than a new one: a
 * dismissal now arrives already classified, so a consumer that forgets to convert it still
 * behaves correctly.
 */
export function promptCancelled(): UserCancelError {
	return new UserCancelError(PROMPT_CANCELLED_MESSAGE);
}
