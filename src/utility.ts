import type {App, TFile} from "obsidian";
import {MarkdownView, TFolder} from "obsidian";
import {log} from "./logger/logManager";

export function getTemplater(app: App) {
    // @ts-ignore
    return app.plugins.plugins["templater-obsidian"]
}

export async function replaceTemplaterTemplatesInCreatedFile(app: App, file: TFile) {
    const templater = getTemplater(app);

    if (templater && !templater?.settings["trigger_on_file_creation"]) {
        await templater.templater.overwrite_file_templates(file);
    }
}

export function getTemplatesFolderPath(app: App): string {
    let path: string = "";
    // @ts-ignore
    const internalTemplatePlugin = app.internalPlugins.plugins.templates;
    if (internalTemplatePlugin) {
        const templateFolderPath = internalTemplatePlugin.instance.options.folder;
        if (templateFolderPath)
            path = templateFolderPath;
    }

    const templater = getTemplater(app);
    if (templater) {
        const templateFolderPath = templater.settings["template_folder"];
        if (templateFolderPath)
            path = templateFolderPath;
    }

    return path;
}

export function getTemplatePaths(app: App): string[] {
    const markdownFiles = app.vault.getMarkdownFiles();
    const templatePath = getTemplatesFolderPath(app);
    return markdownFiles.filter(file => {
        if (file.path.contains(templatePath))
            return file;
    }).map(file => file.path);
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

export function getAllFolders(app: App): string[] {
    return app.vault.getAllLoadedFiles()
        .filter(f => f instanceof TFolder)
        .map(folder => folder.path);
}

export function getUserScriptMemberAccess(fullMemberPath: string): {basename: string | undefined, memberAccess: string[] | undefined} {
    const fullMemberArray: string[] = fullMemberPath.split("::");
    return {
        basename: fullMemberArray[0],
        memberAccess: fullMemberArray.slice(1)
    }
}

export function waitFor(ms: number): Promise<unknown> {
    return new Promise(res => setTimeout(res, ms));
}