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

export async function templaterParseTemplate(app: App, templateContent: string, targetFile: TFile) {
    const templater = getTemplater(app);
    if (!templater) return templateContent;

    return await templater.templater.parse_template({target_file: targetFile, run_mode: 4}, templateContent);
}

function getCoreTemplatesPath(app: App) {
    // @ts-ignore
    const internalTemplatePlugin = app.internalPlugins.plugins.templates;
    if (internalTemplatePlugin) {
        const templateFolderPath = internalTemplatePlugin.instance.options.folder;
        if (templateFolderPath)
            return templateFolderPath;
    }
}

function getTemplaterTemplatesPath(app: App) {
    const templater = getTemplater(app);
    if (templater) {
        const templateFolderPath = templater.settings["template_folder"];
        if (templateFolderPath)
            return templateFolderPath;
    }
}

export function getTemplateFiles(app: App): TFile[] {
    let templateFiles: Set<TFile> = new Set<TFile>();
    const markdownFiles = app.vault.getMarkdownFiles();

    const coreTemplatesPath = getCoreTemplatesPath(app);
    const templaterTemplatesPath = getTemplaterTemplatesPath(app);

    markdownFiles.forEach(file => {
        if (file.path.contains(coreTemplatesPath) || file.path.contains(templaterTemplatesPath))
            templateFiles.add(file);
    });

    return [...templateFiles];
}

export function getTemplatePaths(app: App): string[] {
    return getTemplateFiles(app).map(file => file.path);
}

export function getNaturalLanguageDates(app: App) {
    // @ts-ignore
    return app.plugins.plugins["nldates-obsidian"];
}

export function getDate(input?: {format?: string, offset?: number}) {
    let duration;

    if (input.offset !== null && input.offset !== undefined && typeof input.offset === "number") {
        duration = window.moment.duration(input.offset, "days");
    }

    return input.format ? window.moment().add(duration).format(input.format)
                        : window.moment().add(duration).format("YYYY-MM-DD");
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

export function getLinesInString(input: string) {
    let lines: string[] = [];
    let tempString = input;

    while (tempString.contains("\n")) {
        const lineEndIndex = tempString.indexOf("\n");
        lines.push(tempString.slice(0, lineEndIndex));
        tempString = tempString.slice(lineEndIndex + 1);
    }

    lines.push(tempString);

    return lines;
}