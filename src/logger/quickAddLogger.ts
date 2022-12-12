import type { ILogger } from "./ilogger";
import type { ErrorLevel } from "./errorLevel";
import type { QuickAddError } from "./quickAddError";

export abstract class QuickAddLogger implements ILogger {
	abstract logError(msg: string): void;

	abstract logMessage(msg: string): void;

	abstract logWarning(msg: string): void;

	protected formatOutputString(error: QuickAddError): string {
		return `QuickAdd: (${error.level}) ${error.message}`;
	}

	protected getQuickAddError(
		message: string,
		level: ErrorLevel
	): QuickAddError {
		return { message, level, time: Date.now() };
	}
}
