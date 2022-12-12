import type { ILogger } from "./ilogger";

class LogManager {
	public static loggers: ILogger[] = [];

	public register(logger: ILogger): LogManager {
		LogManager.loggers.push(logger);

		return this;
	}

	logError(message: string) {
		LogManager.loggers.forEach((logger) => logger.logError(message));
	}

	logWarning(message: string) {
		LogManager.loggers.forEach((logger) => logger.logError(message));
	}

	logMessage(message: string) {
		LogManager.loggers.forEach((logger) => logger.logMessage(message));
	}
}

export const log = new LogManager();
