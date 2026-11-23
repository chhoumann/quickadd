import type { ILogger } from "./ilogger";

export class LogManager {
	public static loggers: ILogger[] = [];

	public register(logger: ILogger): LogManager {
		LogManager.loggers.push(logger);

		return this;
	}

	/**
	 * Drop every registered logger. The plugin calls this on unload, so loading
	 * it again registers its loggers once instead of next to the old instance's.
	 */
	public clear(): void {
		LogManager.loggers = [];
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
