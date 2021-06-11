import {Notice} from "obsidian";
import {QuickAddLogger} from "./quickAddLogger";
import type QuickAdd from "../main";
import {ErrorLevel} from "./errorLevel";

export class GuiLogger extends QuickAddLogger {
    constructor(private plugin: QuickAdd) {
        super();
    }

    logError(msg: string): void {
        const error = this.getQuickAddError(msg, ErrorLevel.Error);
        new Notice(this.formatOutputString(error));
    }

    logWarning(msg: string): void {
        const warning = this.getQuickAddError(msg, ErrorLevel.Warning);
        new Notice(this.formatOutputString(warning));
    }

    logMessage(msg: string): void {}
}