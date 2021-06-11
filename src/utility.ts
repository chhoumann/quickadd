import type {App} from "obsidian";

export function getTemplater(app: App) {
    // @ts-ignore
    return app.plugins.plugins["templater-obsidian"]
}

export function getNaturalLanguageDates(app: App) {
    // @ts-ignore
    return app.plugins.plugins["nldates-obsidian"];
}

export function getDate(format: string = "YYYY-MM-DD", offset?: number|string) {
    let duration;

    if (typeof offset === "string")
        duration = window.moment.duration(offset);
    else if (typeof offset === "number")
        duration = window.moment.duration(offset, "days");

    return window.moment().add(duration).format(format);
}