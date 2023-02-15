export interface ILogger {
	logError(msg: string): void;

	logWarning(msg: string): void;

	logMessage(msg: string): void;
}
