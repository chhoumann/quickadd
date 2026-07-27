import { log } from "../logger/logManager";
import type { ErrorLevel } from "../logger/errorLevel";
import { ErrorLevel as ErrorLevelEnum } from "../logger/errorLevel";
import { UserCancelError } from "../errors/UserCancelError";

/**
 * Maximum number of errors to keep in the error log
 */
export const MAX_ERROR_LOG_SIZE = 100;

/**
 * Converts any value to an Error object, preserving the original Error if provided
 * 
 * @param err - The error value to convert
 * @param contextMessage - Optional context message to prepend to error message
 * @returns A proper Error object with stack trace
 * 
 * @example
 * ```ts
 * try {
 *   // Some operation that might throw
 * } catch (err) {
 *   const error = toError(err, "Failed during template processing");
 *   log.logError(error);
 * }
 * ```
 */
export function toError(err: unknown, contextMessage?: string): Error {
  // If it's already an Error, return it as-is when there's no context to add.
  if (err instanceof Error) {
    if (!contextMessage) {
      return err;
    }
    // Do NOT mutate the caller's Error. Mutating err.message compounds context
    // prefixes when the same Error instance is reported through multiple layers
    // (e.g. "outer: inner: original"). Return a fresh Error that prepends the
    // context while preserving the original name and stack trace.
    const wrapped = new Error(`${contextMessage}: ${err.message}`);
    wrapped.name = err.name;
    wrapped.stack = err.stack;
    return wrapped;
  }
  
  // If it's a string, create a new Error with it
  if (typeof err === 'string') {
    return new Error(contextMessage ? `${contextMessage}: ${err}` : err);
  }
  
  // For everything else, convert to string and create an Error
  const errorMessage = contextMessage 
    ? `${contextMessage}: ${String(err)}`
    : String(err);
    
  return new Error(errorMessage);
}

/**
 * Checks if a caught value means "the user backed out" rather than "something broke".
 *
 * Every QuickAdd prompt signals a dismissal by throwing {@link UserCancelError}
 * (see `promptCancelled()`), so this is an `instanceof` check. Because
 * `UserCancelError extends MacroAbortError`, a dismissal that nobody classifies still
 * aborts the run quietly instead of being reported as a failure.
 *
 * @param error - The error to check
 * @returns true if the error indicates user cancellation, false otherwise
 *
 * @example
 * ```ts
 * try {
 *   const result = await promptUser();
 * } catch (error) {
 *   if (isCancellationError(error)) return null; // the user backed out
 *   throw error; // a real failure
 * }
 * ```
 */
export function isCancellationError(error: unknown): boolean {
	// QuickAdd's own prompts throw a typed cancellation (#1577). This is the whole
	// check for every in-plugin prompt; the sentinels below are compatibility only.
	if (error instanceof UserCancelError) return true;

	// Legacy sentinels. QuickAdd's prompts used to reject with one of these bare
	// English sentences and nothing else, so a *user script* may still throw one
	// (or re-throw one it caught), and MacroChoiceEngine has honoured that for as
	// long as the sentinels existed. Kept for that reason alone - no QuickAdd code
	// produces them any more, which `errorUtils.cancellationContract.test.ts`
	// pins. Do not add to this list: a new prompt throws `promptCancelled()`.
	return typeof error === "string" && LEGACY_CANCELLATION_SENTINELS.has(error);
}

/**
 * Bare-string cancellations QuickAdd's prompts rejected with before #1577.
 * Note the two case variants of one sentence - that inconsistency is exactly why
 * string matching was the wrong signal.
 */
const LEGACY_CANCELLATION_SENTINELS: ReadonlySet<string> = new Set([
	"no input given.", // GenericSuggester, InputSuggester, GenericCheckboxPrompt, MultiSuggester
	"No input given.", // GenericInputPrompt, GenericWideInputPrompt, MathModal, MultiChoiceSettingsModal
	"cancelled", // OnePageInputModal
]);

/**
 * When {@link reportError} last showed the user each value.
 *
 * One failure travelled up through two reporting layers and produced two stacked
 * 15-second notices for one bug (#1601): `MacroChoiceEngine` reports a script failure
 * AND re-throws it, and the command-palette handler in `main.ts` reports it again. Both
 * layers are right to report - neither can know whether anything above it will - so
 * "report once" belongs in the function they both call, not in a rule each has to
 * remember.
 *
 * Keyed on the value's IDENTITY, not its message: two independent failures with the
 * same text still both report, and the same failure re-thrown through five layers
 * reports once. A `WeakMap` so a reported Error is still collectable.
 */
const reportedErrors = new WeakMap<object, number>();

/**
 * How long a value stays "already reported".
 *
 * Suppression has to expire, or a long-lived user-script module that re-throws one
 * cached `Error` on every invocation would be reported the first time and then
 * silently forever after - a command that does nothing, which is the failure the whole
 * reporting seam exists to remove. One propagation unwinds in microseconds, so any
 * window comfortably above that collapses the stacked notices while leaving separate
 * runs separate. Same value, and the same reasoning, as the unhandled-rejection
 * reporter's repeat window.
 */
const REPORT_WINDOW_MS = 10_000;

/** Bound the `cause` walk; also what stops a cyclic `cause` chain from spinning. */
const MAX_CAUSE_DEPTH = 8;

function isTrackable(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/**
 * True if this value, or any error it was wrapped around, has already been reported.
 *
 * The `cause` chain matters because not every layer re-throws the same instance: the AI
 * request path reports the provider error and then throws
 * `new Error("Error while making request to …", { cause: error })`, so identity alone
 * would let that pair through as two notices for one failed request.
 */
function alreadyReported(err: unknown, at: number): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && isTrackable(current); depth++) {
    const reportedAt = reportedErrors.get(current);
    if (reportedAt !== undefined && at - reportedAt < REPORT_WINDOW_MS) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Reports an error to the logging system with additional context
 * Converts any error type to a proper Error object and logs it with the appropriate level
 *
 * Reports each failure ONCE: a value already reported (directly, or as the `cause` of one)
 * is dropped for {@link REPORT_WINDOW_MS}, so the innermost layer - the one with the most
 * specific context - is the one the user sees. See {@link reportedErrors}.
 *
 * @param err - The error to report
 * @param contextMessage - Optional context message to add
 * @param level - Error level (defaults to ERROR)
 * @returns true if this call reported, false if the failure had already been reported
 *
 * @example
 * ```ts
 * try {
 *   // Some operation
 * } catch (err) {
 *   reportError(err, "Failed during template processing");
 * }
 * ```
 */
export function reportError(
  err: unknown,
  contextMessage?: string,
  level: ErrorLevel = ErrorLevelEnum.Error
): boolean {
  const at = Date.now();
  if (alreadyReported(err, at)) return false;
  // Mark the value itself, not the whole chain: the rule is "do not report a failure
  // whose cause the user has already seen", not "reporting a wrapper silences its parts".
  if (isTrackable(err)) reportedErrors.set(err, at);

  const error = toError(err, contextMessage);

  switch (level) {
    case ErrorLevelEnum.Error:
      log.logError(error);
      break;
    case ErrorLevelEnum.Warning:
      log.logWarning(error);
      break;
    case ErrorLevelEnum.Log:
      log.logMessage(error);
      break;
    default:
      // Ensure exhaustiveness
      log.logError(error);
  }
  return true;
}

/**
 * Reports a failure, staying silent for a dismissal.
 *
 * The outermost handlers - the command-palette callback, the choice picker - catch
 * whatever a run threw, and a user pressing Escape reaches them exactly like a bug does.
 * Reporting that as `(ERROR) Error executing choice <uuid>: One-page input cancelled by
 * user` for a deliberate Escape is the failure PR #1606's first rule exists to prevent,
 * and it is what those handlers did before this guard.
 *
 * @returns true if it reported; false for a cancellation or an already-reported failure.
 */
export function reportUnlessCancelled(
  err: unknown,
  contextMessage?: string,
  level: ErrorLevel = ErrorLevelEnum.Error,
): boolean {
  if (isCancellationError(err)) return false;
  return reportError(err, contextMessage, level);
}

/**
 * Error boundary - wraps a function and reports any errors it throws
 * 
 * @param fn - Function to execute
 * @param contextMessage - Context message for any errors
 * @param level - Error level for logging
 * @returns The function's return value or undefined if an error occurred
 * 
 * @example
 * ```ts
 * const result = withErrorHandling(
 *   () => JSON.parse(someString),
 *   "Failed to parse JSON"
 * );
 * ```
 */
export function withErrorHandling<T>(
  fn: () => T,
  contextMessage?: string,
  level: ErrorLevel = ErrorLevelEnum.Error
): T | undefined {
  try {
    return fn();
  } catch (err) {
    reportError(err, contextMessage, level);
    return undefined;
  }
}

/**
 * Wraps a UI event handler so a failure is REPORTED instead of vanishing.
 *
 * Svelte re-throws event-handler errors to the window
 * (`internal/client/dom/elements/events.js`), and an `async` handler's rejection
 * is an unhandled rejection - Obsidian surfaces neither. The result is a button
 * that simply does nothing, with no Notice and no message the user would ever
 * think to look for, which reads as "the plugin is broken" and gives them nothing
 * to report (#1585). `<svelte:boundary>` does not help: it catches render and
 * effect errors, not event handlers.
 *
 * Handles both halves of the problem - a synchronous throw and a rejected promise
 * - and stays quiet for the cancellations that are an answer rather than a
 * failure (see {@link isCancellationError}).
 *
 * The wrapper returns `void`: it is for handlers whose result nobody awaits. Keep
 * calling the unwrapped function anywhere the caller needs its value or wants to
 * handle the failure itself.
 *
 * @param contextMessage - Names the action that failed, e.g. "Couldn't delete that choice"
 * @param fn - The handler to wrap
 *
 * @example
 * ```ts
 * const actions = { onDelete: reportingHandler("Couldn't delete that choice", deleteChoice) };
 * ```
 */
export function reportingHandler<A extends unknown[]>(
  contextMessage: string,
  fn: (...args: A) => unknown,
): (...args: A) => void {
  const report = (err: unknown): void => {
    reportUnlessCancelled(err, contextMessage);
  };

  return (...args: A): void => {
    try {
      const result = fn(...args);
      // Duck-typed rather than `instanceof Promise`: a thenable, or a promise from
      // another realm, still needs its rejection caught. Assimilated with
      // Promise.resolve rather than calling `.catch` on it directly — a thenable is
      // only required to have `.then`, so `.catch` can be undefined, and reporting
      // "result.catch is not a function" in place of the real failure is exactly the
      // kind of lost error this helper exists to prevent.
      if (typeof (result as { then?: unknown } | null | undefined)?.then === "function") {
        void Promise.resolve(result).catch(report);
      }
    } catch (err) {
      report(err);
    }
  };
}

/**
 * Async error boundary - wraps an async function and reports any errors it throws
 * 
 * @param fn - Async function to execute
 * @param contextMessage - Context message for any errors
 * @param level - Error level for logging
 * @returns Promise resolving to the function's return value or undefined if an error occurred
 * 
 * @example
 * ```ts
 * const result = await withAsyncErrorHandling(
 *   () => fetch(url).then(r => r.json()),
 *   "Failed to fetch data"
 * );
 * ```
 */
export async function withAsyncErrorHandling<T>(
  fn: () => Promise<T>,
  contextMessage?: string,
  level: ErrorLevel = ErrorLevelEnum.Error
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    reportError(err, contextMessage, level);
    return undefined;
  }
}