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
