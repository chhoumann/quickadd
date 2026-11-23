import { Notice } from "obsidian";
import { QuickAddLogger } from "./quickAddLogger";
import { ErrorLevel } from "./errorLevel";

export class GuiLogger extends QuickAddLogger {
	logError(msg: string, stack?: string, originalError?: Error): void {
		const error = this.getQuickAddError(msg, ErrorLevel.Error, stack, originalError);
		new Notice(this.formatOutputString(error), 15000);
	}

	logWarning(msg: string, stack?: string, originalError?: Error): void {
		const warning = this.getQuickAddError(msg, ErrorLevel.Warning, stack, originalError);
		new Notice(this.formatOutputString(warning));
	}

	logMessage(msg: string, stack?: string, originalError?: Error): void {}
}
