import type { ILogger } from "./ilogger";

/**
 * Helper function to convert any value to an Error object
 * @param err The error value to convert
 * @returns Error object
 */
export function toError(err: unknown): Error {
	if (err instanceof Error) return err;
	return new Error(typeof err === 'string' ? err : String(err));
}

class LogManager {
	public static loggers: ILogger[] = [];

	public register(logger: ILogger): LogManager {
		LogManager.loggers.push(logger);

		return this;
	}

	logError(message: string | Error) {
		const messageStr = message instanceof Error ? message.message : message;
		const stack = message instanceof Error ? message.stack : undefined;
		const originalError = message instanceof Error ? message : undefined;
		
		LogManager.loggers.forEach((logger) => logger.logError(messageStr, stack, originalError));
	}

	logWarning(message: string | Error) {
		const messageStr = message instanceof Error ? message.message : message;
		const stack = message instanceof Error ? message.stack : undefined;
		const originalError = message instanceof Error ? message : undefined;
		
		LogManager.loggers.forEach((logger) => logger.logWarning(messageStr, stack, originalError));
	}

	logMessage(message: string | Error) {
		const messageStr = message instanceof Error ? message.message : message;
		const stack = message instanceof Error ? message.stack : undefined;
		const originalError = message instanceof Error ? message : undefined;
		
		LogManager.loggers.forEach((logger) => logger.logMessage(messageStr, stack, originalError));
	}
}

export const log = new LogManager();
