import { ErrorLevel } from "./errorLevel";
import { QuickAddLogger } from "./quickAddLogger";
import type { QuickAddError } from "./quickAddError";

export class ConsoleErrorLogger extends QuickAddLogger {
	public ErrorLog: QuickAddError[] = [];

	public logError(errorMsg: string, stack?: string, originalError?: Error) {
		const error = this.getQuickAddError(errorMsg, ErrorLevel.Error, stack, originalError);
		this.addMessageToErrorLog(error);

		// Always pass the original error or create a new one to leverage Dev Tools' stack trace UI
		const errorToLog = originalError || new Error(errorMsg);
		
		// Just log the message as the first argument and the error object as the second
		console.error(this.formatOutputString(error), errorToLog);
	}

	public logWarning(warningMsg: string, stack?: string, originalError?: Error) {
		const warning = this.getQuickAddError(warningMsg, ErrorLevel.Warning, stack, originalError);
		this.addMessageToErrorLog(warning);

		// Always pass the original error or create a new one to leverage Dev Tools' stack trace UI
		const errorToLog = originalError || new Error(warningMsg);
		
		console.warn(this.formatOutputString(warning), errorToLog);
	}

	public logMessage(logMsg: string, stack?: string, originalError?: Error) {
		const log = this.getQuickAddError(logMsg, ErrorLevel.Log, stack, originalError);
		this.addMessageToErrorLog(log);

		// For regular logs, we'll still show the error if available
		if (originalError) {
			console.log(this.formatOutputString(log), originalError);
		} else {
			console.log(this.formatOutputString(log));
		}
	}

	private addMessageToErrorLog(error: QuickAddError): void {
		this.ErrorLog.push(error);
	}
}
