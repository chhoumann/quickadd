import { ErrorLevel } from "./errorLevel";
import { QuickAddLogger } from "./quickAddLogger";
import type { QuickAddError } from "./quickAddError";

export class ConsoleErrorLogger extends QuickAddLogger {
	public ErrorLog: QuickAddError[] = [];

	public logError(errorMsg: string, stack?: string, originalError?: Error) {
		const error = this.getQuickAddError(errorMsg, ErrorLevel.Error, stack, originalError);
		this.addMessageToErrorLog(error);

		if (originalError) {
			console.error(this.formatOutputString(error), originalError);
		} else {
			console.error(this.formatOutputString(error));
		}
	}

	public logWarning(warningMsg: string, stack?: string, originalError?: Error) {
		const warning = this.getQuickAddError(warningMsg, ErrorLevel.Warning, stack, originalError);
		this.addMessageToErrorLog(warning);

		if (originalError) {
			console.warn(this.formatOutputString(warning), originalError);
		} else {
			console.warn(this.formatOutputString(warning));
		}
	}

	public logMessage(logMsg: string, stack?: string, originalError?: Error) {
		const log = this.getQuickAddError(logMsg, ErrorLevel.Log, stack, originalError);
		this.addMessageToErrorLog(log);

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
