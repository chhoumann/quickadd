import { ErrorLevel } from "./errorLevel";
import { QuickAddLogger } from "./quickAddLogger";
import type { QuickAddError } from "./quickAddError";
import { MAX_ERROR_LOG_SIZE } from "../utils/errorUtils";

/**
 * Passes native Error objects to the console so DevTools renders their stack
 * traces, and keeps a bounded in-memory error log.
 */
export class ConsoleErrorLogger extends QuickAddLogger {
	public ErrorLog: QuickAddError[] = [];

	public logError(errorMsg: string, stack?: string, originalError?: Error) {
		const error = this.getQuickAddError(errorMsg, ErrorLevel.Error, stack, originalError);
		this.addMessageToErrorLog(error);

		const errorToLog = originalError || new Error(errorMsg);
		
		console.error(this.formatOutputString(error), errorToLog);
	}

	public logWarning(warningMsg: string, stack?: string, originalError?: Error) {
		const warning = this.getQuickAddError(warningMsg, ErrorLevel.Warning, stack, originalError);
		this.addMessageToErrorLog(warning);

		const errorToLog = originalError || new Error(warningMsg);
		
		console.warn(this.formatOutputString(warning), errorToLog);
	}

	public logMessage(logMsg: string, stack?: string, originalError?: Error) {
		const log = this.getQuickAddError(logMsg, ErrorLevel.Log, stack, originalError);
		this.addMessageToErrorLog(log);
	}

	private addMessageToErrorLog(error: QuickAddError): void {
		this.ErrorLog.push(error);
		
		if (this.ErrorLog.length > MAX_ERROR_LOG_SIZE) {
			this.ErrorLog = this.ErrorLog.slice(-MAX_ERROR_LOG_SIZE);
		}
	}
	
	public clearErrorLog(): void {
		this.ErrorLog = [];
	}
}
