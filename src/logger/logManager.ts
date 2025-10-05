import type { ILogger } from "./ilogger";

/**
 * Helper function to convert any value to an Error object
 * This function ensures that an Error object is always returned, preserving
 * the original Error if provided or creating a new one otherwise.
 *
 * @param err - The error value to convert (can be any type)
 * @returns A proper Error object with stack trace
 *
 * @example
 * ```ts
 * try {
 *   // Some operation
 * } catch (err) {
 *   log.logError(toError(err));
 * }
 * ```
 */
export function toError(err: unknown): Error {
	if (err instanceof Error) return err;
	return new Error(typeof err === "string" ? err : String(err));
}

export class LogManager {
	public static loggers: ILogger[] = [];

	public register(logger: ILogger): LogManager {
		LogManager.loggers.push(logger);

		return this;
	}

	logError(message: string | Error) {
		const messageStr = message instanceof Error ? message.message : message;
		const stack = message instanceof Error ? message.stack : undefined;
		const originalError = message instanceof Error ? message : undefined;

		for (const logger of LogManager.loggers) {
			logger.logError(messageStr, stack, originalError);
		}
	}

	logWarning(message: string | Error) {
		const messageStr = message instanceof Error ? message.message : message;
		const stack = message instanceof Error ? message.stack : undefined;
		const originalError = message instanceof Error ? message : undefined;

		for (const logger of LogManager.loggers) {
			logger.logWarning(messageStr, stack, originalError);
		}
	}

	logMessage(message: string | Error) {
		const messageStr = message instanceof Error ? message.message : message;
		const stack = message instanceof Error ? message.stack : undefined;
		const originalError = message instanceof Error ? message : undefined;

		for (const logger of LogManager.loggers) {
			logger.logMessage(messageStr, stack, originalError);
		}
	}
}

export const log = new LogManager();
