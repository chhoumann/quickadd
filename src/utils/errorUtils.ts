import { log } from "../logger/logManager";
import type { ErrorLevel } from "../logger/errorLevel";
import { ErrorLevel as ErrorLevelEnum } from "../logger/errorLevel";
import { UserCancelError } from "../errors/UserCancelError";

export const MAX_ERROR_LOG_SIZE = 100;

/**
 * Preserve Error identity unless adding context. Context wrapping preserves the
 * original name and stack without mutating the caller's error.
 */
export function toError(err: unknown, contextMessage?: string): Error {
  if (err instanceof Error) {
    if (!contextMessage) {
      return err;
    }
    // Never mutate the caller's Error: the same instance reported through
    // several layers would compound prefixes.
    const wrapped = new Error(`${contextMessage}: ${err.message}`);
    wrapped.name = err.name;
    wrapped.stack = err.stack;
    return wrapped;
  }
  
  const errorMessage = contextMessage 
    ? `${contextMessage}: ${String(err)}`
    : String(err);
    
  return new Error(errorMessage);
}

/**
 * Recognize typed dismissals and the released bare-string cancellation sentinels.
 */
export function isCancellationError(error: unknown): boolean {
	// QuickAdd's own prompts throw a typed cancellation.
	if (error instanceof UserCancelError) return true;

	// A user script may still throw one of the bare strings QuickAdd's prompts
	// used to reject with. No QuickAdd code produces them; do not add to the list.
	return typeof error === "string" && LEGACY_CANCELLATION_SENTINELS.has(error);
}

/** Bare-string cancellations QuickAdd's prompts used to reject with. */
const LEGACY_CANCELLATION_SENTINELS: ReadonlySet<string> = new Set([
	"no input given.",
	"No input given.",
	"cancelled",
]);

/**
 * When {@link reportError} last showed each value. Several layers legitimately
 * report the same failure, so "report once" lives here. Keyed by identity, not
 * message, in a WeakMap so a reported Error stays collectable.
 */
const reportedErrors = new WeakMap<object, number>();

/**
 * Suppression expires, or a script that re-throws one cached Error on every run
 * would go silent after the first. One propagation unwinds in microseconds.
 */
const REPORT_WINDOW_MS = 10_000;

/** Bound the `cause` walk; also what stops a cyclic `cause` chain from spinning. */
const MAX_CAUSE_DEPTH = 8;

function isTrackable(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

/**
 * True if this value, or any error in its `cause` chain, was already reported.
 * Some layers wrap the failure rather than re-throw it.
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
      log.logError(error);
  }
  return true;
}

/**
 * Record that the user has already seen this failure through another surface,
 * so a {@link reportError} further up does not show it again.
 */
export function markErrorReported(err: unknown): void {
  if (isTrackable(err)) reportedErrors.set(err, Date.now());
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
      // Duck-typed, so a thenable or cross-realm promise is caught too.
      // Promise.resolve assimilates it, since a thenable may lack `.catch`.
      if (typeof (result as { then?: unknown } | null | undefined)?.then === "function") {
        void Promise.resolve(result).catch(report);
      }
    } catch (err) {
      report(err);
    }
  };
}

/**
 * Settles like `promise`, except that an unawaited cancellation is not an
 * unhandled rejection; real failures stay unhandled so they are reported.
 * Obsidian's `dev:errors` records every unhandled rejection, even ones claimed
 * with `preventDefault()`.
 */
export function handledIfCancelled<T>(promise: Promise<T>): Promise<T> {
  const result: Promise<T> = promise.then(undefined, (error: unknown) => {
    // A handler attached before `result` rejects marks it handled; awaiting callers
    // attach their own and still see the error.
    if (isCancellationError(error)) result.catch(() => undefined);
    throw error;
  });
  return result;
}