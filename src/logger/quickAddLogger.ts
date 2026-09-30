import type { ILogger } from "./ilogger";
import type { ErrorLevel } from "./errorLevel";
import type { QuickAddError } from "./quickAddError";

/**
 * A message without the "QuickAdd:" it may open with. Messages written for a
 * Notice often carry the brand themselves, but the logger adds
 * "QuickAdd: (LEVEL)" and the builders' preview shows them under a QuickAdd
 * field, so both drop it. The template cycle/depth reports arrive wrapped as
 * `[QuickAdd: ... ]`, because the same string is also spliced into the output
 * as a placeholder, so they are unwrapped first.
 */
export function withoutBrandPrefix(message: string): string {
	const unwrapped = message.replace(/^\[(QuickAdd:[\s\S]*)\]$/i, "$1");
	return unwrapped.replace(/^QuickAdd:\s*/i, "");
}

export abstract class QuickAddLogger implements ILogger {
	abstract logError(msg: string, stack?: string, originalError?: Error): void;

	abstract logMessage(msg: string, stack?: string, originalError?: Error): void;

	abstract logWarning(msg: string, stack?: string, originalError?: Error): void;

	protected formatOutputString(error: QuickAddError): string {
		// Just return the basic message without stack trace, as we'll pass the error object separately
		return `QuickAdd: (${error.level}) ${withoutBrandPrefix(error.message)}`;
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
