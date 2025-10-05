import { ErrorLevel } from "./errorLevel";
import { QuickAddLogger } from "./quickAddLogger";
import type { QuickAddError } from "./quickAddError";
import { MAX_ERROR_LOG_SIZE } from "../utils/errorUtils";

/**
 * Logger implementation that outputs to the browser console and maintains an error log
 * with a maximum size to prevent memory leaks. Uses native Error objects to leverage
 * browser DevTools stack trace display.
 */
export class ConsoleErrorLogger extends QuickAddLogger {
	/**
	 * In-memory log of errors for debugging
	 * Limited to MAX_ERROR_LOG_SIZE entries to prevent memory leaks
	 */
	public ErrorLog: QuickAddError[] = [];

	/**
	 * Logs an error to the console with proper stack trace handling
	 *
	 * @param errorMsg - Error message or Error object
	 * @param stack - Optional stack trace string
	 * @param originalError - Optional original Error object
	 */
	public logError(errorMsg: string, stack?: string, originalError?: Error) {
		const error = this.getQuickAddError(
			errorMsg,
			ErrorLevel.Error,
			stack,
			originalError
		);
		this.addMessageToErrorLog(error);

		// Always pass the original error or create a new one to leverage Dev Tools' stack trace UI
		const errorToLog = originalError || new Error(errorMsg);

		// Just log the message as the first argument and the error object as the second
		console.error(this.formatOutputString(error), errorToLog);
	}

	/**
	 * Logs a warning to the console with proper stack trace handling
	 *
	 * @param warningMsg - Warning message or Error object
	 * @param stack - Optional stack trace string
	 * @param originalError - Optional original Error object
	 */
	public logWarning(warningMsg: string, stack?: string, originalError?: Error) {
		const warning = this.getQuickAddError(
			warningMsg,
			ErrorLevel.Warning,
			stack,
			originalError
		);
		this.addMessageToErrorLog(warning);

		// Always pass the original error or create a new one to leverage Dev Tools' stack trace UI
		const errorToLog = originalError || new Error(warningMsg);

		console.warn(this.formatOutputString(warning), errorToLog);
	}

	/**
	 * Logs a message to the console
	 *
	 * @param logMsg - Log message
	 * @param stack - Optional stack trace string
	 * @param originalError - Optional original Error object
	 */
	public logMessage(logMsg: string, stack?: string, originalError?: Error) {
		const log = this.getQuickAddError(
			logMsg,
			ErrorLevel.Log,
			stack,
			originalError
		);
		this.addMessageToErrorLog(log);

		// For regular logs, we'll still show the error if available
		if (originalError) {
			console.log(this.formatOutputString(log), originalError);
		} else {
			console.log(this.formatOutputString(log));
		}
	}

	/**
	 * Adds an error to the error log, maintaining the maximum size limit
	 * by removing the oldest entries when needed
	 *
	 * @param error - Error to add to the log
	 */
	private addMessageToErrorLog(error: QuickAddError): void {
		// Add the new error
		this.ErrorLog.push(error);

		// If we've exceeded the maximum size, remove the oldest entries
		if (this.ErrorLog.length > MAX_ERROR_LOG_SIZE) {
			this.ErrorLog = this.ErrorLog.slice(-MAX_ERROR_LOG_SIZE);
		}
	}

	/**
	 * Clears the error log
	 */
	public clearErrorLog(): void {
		this.ErrorLog = [];
	}
}
