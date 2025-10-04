import { log } from "../logger/logManager";
import type { ErrorLevel } from "../logger/errorLevel";
import { ErrorLevel as ErrorLevelEnum } from "../logger/errorLevel";

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
  // If it's already an Error, just add context if needed
  if (err instanceof Error) {
    if (contextMessage) {
      err.message = `${contextMessage}: ${err.message}`;
    }
    return err;
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
 * Checks if an error indicates user cancellation rather than a real error.
 * Used to distinguish between intentional user cancellations (Escape key, Cancel button)
 * and actual errors (network failures, file system errors, etc.)
 * 
 * @param error - The error to check
 * @returns true if the error indicates user cancellation, false otherwise
 * 
 * @example
 * ```ts
 * try {
 *   const result = await promptUser();
 * } catch (error) {
 *   if (isCancellationError(error)) {
 *     throw new MacroAbortError("Input cancelled by user");
 *   }
 *   throw error; // Re-throw actual errors
 * }
 * ```
 */
export function isCancellationError(error: unknown): boolean {
	if (typeof error !== "string") return false;
	
	const cancellationMessages = [
		"no input given.",      // GenericSuggester, InputSuggester, GenericCheckboxPrompt
		"No input given.",      // GenericInputPrompt, MathModal
		"No answer given.",     // GenericYesNoPrompt
		"cancelled"             // OnePagePreflight
	];
	
	return cancellationMessages.includes(error);
}

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