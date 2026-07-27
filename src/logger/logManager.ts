import type { ILogger } from "./ilogger";

// There used to be a second `toError` here, a context-less twin of the one in
// `utils/errorUtils`. Its existence is why #1604 happened: the two suggesters
// imported THIS one, so the safe helper's "do NOT mutate the caller's Error"
// contract did not apply to the call sites that most needed it, and they hand-rolled
// the mutation it forbids. One helper now, in `utils/errorUtils`.

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
