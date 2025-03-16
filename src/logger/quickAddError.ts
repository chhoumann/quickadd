import type { ErrorLevel } from "./errorLevel";

export interface QuickAddError {
	message: string;
	level: ErrorLevel;
	time: number;
	stack?: string;
	originalError?: Error;
}
