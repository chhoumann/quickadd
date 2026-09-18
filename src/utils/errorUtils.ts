import { log } from "../logger/logManager";
import type { ErrorLevel } from "../logger/errorLevel";
import { ErrorLevel as ErrorLevelEnum } from "../logger/errorLevel";
import { UserCancelError } from "../errors/UserCancelError";

/**
 * Maximum number of errors to keep in the error log
 */
export const MAX_ERROR_LOG_SIZE = 100;

/**
 * Preserve Error identity unless adding context. Context wrapping preserves the
 * original name and stack without mutating the caller's error.
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
  
  // For everything else, convert to string and create an Error
  const errorMessage = contextMessage 
    ? `${contextMessage}: ${String(err)}`
    : String(err);
    
  return new Error(errorMessage);
}

/**
 * Recognize typed dismissals and the released bare-string cancellation sentinels.
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
 * Report a failure once per identity/cause within REPORT_WINDOW_MS. The first
 * reporting layer supplies the context. Returns false if already reported.
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
 * Report failures while keeping cancellations silent. Returns whether reported.
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
 * Return the result, or report a synchronous failure and return undefined.
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
 * Wrap fire-and-forget UI handlers, reporting synchronous throws and promise
 * rejections while keeping cancellations silent. Call the original function
 * when its result or rejection must reach the caller.
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
 * Return the result, or report an asynchronous failure and return undefined.
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