import type ITemplateChoice from "../types/choices/ITemplateChoice";
import {CompleteFormatter} from "../formatters/completeFormatter";
import {App, TAbstractFile, TFile} from "obsidian";
import {appendToCurrentLine, getTemplater} from "../utility";
import {FILE_NUMBER_REGEX, MARKDOWN_FILE_EXTENSION_REGEX, NAME_VALUE_REGEX} from "../constants";
import GenericInputPrompt from "../gui/GenericInputPrompt/genericInputPrompt";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import {QuickAddEngine} from "./QuickAddEngine";
import {log} from "../logger/logManager";
import type QuickAdd from "../main";

export class TemplateChoiceEngine extends QuickAddEngine {
    public choice: ITemplateChoice;
    private formatter: CompleteFormatter;
    private readonly templater;

    constructor(app: App, private plugin: QuickAdd, choice: ITemplateChoice) {
        super(app);
        this.choice = choice;
        this.templater = getTemplater(app);
        this.formatter = new CompleteFormatter(app, plugin);
    }

    public async run(): Promise<void> {
        try {
            const folderPath = await this.getOrCreateFolder();
            let filePath = await this.getFilePath(folderPath);

            if (this.choice.incrementFileName)
                filePath = await this.incrementFileName(filePath);

            const createdFile: TFile = await this.createFileWithTemplate(filePath);
            if (!createdFile) {
                log.logError(`Could not create file '${filePath}'.`);
                return;
            }

            if (this.choice.appendLink) {
                const linkString = `[[${createdFile.path.replace(MARKDOWN_FILE_EXTENSION_REGEX, '')}]]`;
                appendToCurrentLine(linkString, this.app);
            }

            if (this.choice.openFile) {
                if (!this.choice.openFileInNewTab.enabled) {
                    await this.app.workspace.activeLeaf.openFile(createdFile);
                } else {
                    await this.app.workspace.splitActiveLeaf(this.choice.openFileInNewTab.direction)
                        .openFile(createdFile);
                }
            }
        }
        catch (e) {
            log.logError(e.message);
        }
    }

    private async getFilePath(folderPath: string) {
        const needName = !this.choice.fileNameFormat.enabled || !NAME_VALUE_REGEX.test(this.choice.fileNameFormat.format);
        const name = needName ? await GenericInputPrompt.Prompt(this.app, this.choice.name) : "";
        if (needName && !name) throw new Error("No filename provided.");

        return this.choice.fileNameFormat.enabled ?
            await this.getFormattedFilePath(folderPath) :
            this.formatFilePath(folderPath, name);
    }

    private async getOrCreateFolder(): Promise<string> {
        const folders: string[] = this.choice.folder.folders;
        let folderPath: string;

        if (folders.length > 1) {
            folderPath = await GenericSuggester.Suggest(this.app, folders, folders);
            if (!folderPath) return null;
        } else {
            folderPath = folders[0];
        }

        if (folderPath)
            await this.createFolder(folderPath);
        else
            folderPath = "";

        return folderPath;
    }

    private async getFormattedFilePath(folderPath: string): Promise<string> {
        const formattedName = await this.formatter.formatFileName(this.choice.fileNameFormat.format, this.choice.name);
        return this.formatFilePath(folderPath, formattedName);
    }

    private async incrementFileName(fileName: string) {
        const numStr = FILE_NUMBER_REGEX.exec(fileName)[1];
        const fileExists = await this.app.vault.adapter.exists(fileName);
        let newFileName = fileName;

        if (fileExists && numStr) {
            const number = parseInt(numStr);
            if (!number) throw new Error("detected numbers but couldn't get them.")

            newFileName = newFileName.replace(FILE_NUMBER_REGEX, `${number + 1}.md`);
        } else if (fileExists) {
            newFileName = newFileName.replace(FILE_NUMBER_REGEX, `${1}.md`);
        }

        const newFileExists = await this.app.vault.adapter.exists(newFileName);
        if (newFileExists)
            newFileName = await this.incrementFileName(newFileName);

        return newFileName;
    }

    private async createFileWithTemplate(filePath: string) {
        const templateFile: TAbstractFile = this.app.vault.getAbstractFileByPath(this.choice.templatePath);
        if (!(templateFile instanceof TFile)) return;

        const templateContent: string = await this.app.vault.cachedRead(templateFile);
        const formattedTemplateContent: string = await this.formatter.formatFileContent(templateContent);

        const createdFile: TFile = await this.app.vault.create(filePath, formattedTemplateContent);

        if (this.templater && !this.templater.settings["trigger_on_file_creation"]) {
            await this.templater.templater.overwrite_file_templates(createdFile);
        }

        return createdFile;
    }
}