import type {App} from "obsidian";
import {Notice} from "obsidian";
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
        // @ts-ignore
        const editor = app.workspace.activeLeaf.view.editor;
        const selected = editor.getSelection();

        editor.replaceSelection(`${selected}${toAppend}`);
    } catch {
       log.logError(`unable to append '${toAppend}' to current line.`);
    }
}

export function findObsidianCommand(commandId: string) {
    // @ts-ignore
    return app.commands.findCommand(commandId);
}

export function deleteObsidianCommand(commandId: string) {
    if (findObsidianCommand(commandId)) {
        // @ts-ignore
        delete app.commands.commands[commandId];
        // @ts-ignore
        delete app.commands.editorCommands[commandId];
    }
}