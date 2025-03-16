export interface ILogger {
	logError(msg: string, stack?: string, originalError?: Error): void;

	logWarning(msg: string, stack?: string, originalError?: Error): void;

	logMessage(msg: string, stack?: string, originalError?: Error): void;
}
