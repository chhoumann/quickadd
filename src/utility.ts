import type {App} from "obsidian";
import {MarkdownView, Notice} from "obsidian";
import {log} from "./logger/logManager";

export function getTemplater(app: App) {
    // @ts-ignore
    return app.plugins.plugins["templater-obsidian"]
}

export function getNaturalLanguageDates(app: App) {
    // @ts-ignore
    return app.plugins.plugins["nldates-obsidian"];
}

export function getDate(input?: {format?: string, offset?: number|string}) {
    let duration;

    if (input.offset) {
        if(typeof input.offset === "string")
            duration = window.moment.duration(input.offset);
        else if (typeof input.offset === "number")
            duration = window.moment.duration(input.offset, "days");
    }

    return input.format ? window.moment().add(duration).format(input.format) : window.moment().add(duration).format("YYYY-MM-DD");
}

export function appendToCurrentLine(toAppend: string, app: App) {
    try {
        const activeView = app.workspace.getActiveViewOfType(MarkdownView);

        if (!activeView) {
            log.logError(`unable to append '${toAppend}' to current line.`);
            return;
        }

        const selected = activeView.editor.getSelection();

        activeView.editor.replaceSelection(`${selected}${toAppend}`);
    } catch {
       log.logError(`unable to append '${toAppend}' to current line.`);
    }
}

export function findObsidianCommand(app: App, commandId: string) {
    // @ts-ignore
    return app.commands.findCommand(commandId);
}

export function deleteObsidianCommand(app: App, commandId: string) {
    if (findObsidianCommand(app, commandId)) {
        // @ts-ignore
        delete app.commands.commands[commandId];
        // @ts-ignore
        delete app.commands.editorCommands[commandId];
    }
}