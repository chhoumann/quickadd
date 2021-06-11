import type {App} from "obsidian";

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