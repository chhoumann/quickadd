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
 * Reports an error to the logging system with additional context
 * Converts any error type to a proper Error object and logs it with the appropriate level
 * 
 * @param err - The error to report
 * @param contextMessage - Optional context message to add
 * @param level - Error level (defaults to ERROR)
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
): void {
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