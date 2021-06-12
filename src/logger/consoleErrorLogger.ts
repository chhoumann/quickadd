import {ErrorLevel} from "./errorLevel";
import {QuickAddLogger} from "./quickAddLogger";
import type {QuickAddError} from "./quickAddError";

export class ConsoleErrorLogger extends QuickAddLogger {
    public ErrorLog: QuickAddError[] = [];

    public logError(errorMsg: string) {
        const error = this.getQuickAddError(errorMsg, ErrorLevel.Error);
        this.addMessageToErrorLog(error);

        console.error(this.formatOutputString(error));
    }

    public logWarning(warningMsg: string) {
        const warning = this.getQuickAddError(warningMsg, ErrorLevel.Warning);
        this.addMessageToErrorLog(warning);

        console.warn(this.formatOutputString(warning));
    }

    public logMessage(logMsg: string) {
        const log = this.getQuickAddError(logMsg, ErrorLevel.Log);
        this.addMessageToErrorLog(log);

        console.log(this.formatOutputString(log));
    }

    private addMessageToErrorLog(error: QuickAddError): void {
        this.ErrorLog.push(error);
    }
}