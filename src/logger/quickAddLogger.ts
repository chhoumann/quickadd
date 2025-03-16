import type { ILogger } from "./ilogger";
import type { ErrorLevel } from "./errorLevel";
import type { QuickAddError } from "./quickAddError";

export abstract class QuickAddLogger implements ILogger {
	abstract logError(msg: string, stack?: string, originalError?: Error): void;

	abstract logMessage(msg: string, stack?: string, originalError?: Error): void;

	abstract logWarning(msg: string, stack?: string, originalError?: Error): void;

	protected formatOutputString(error: QuickAddError): string {
		// Just return the basic message without stack trace, as we'll pass the error object separately
		return `QuickAdd: (${error.level}) ${error.message}`;
	}

	protected getQuickAddError(
		message: string,
		level: ErrorLevel,
		stack?: string,
		originalError?: Error
	): QuickAddError {
		return { 
			message, 
			level, 
			time: Date.now(),
			stack,
			originalError
		};
	}
}
