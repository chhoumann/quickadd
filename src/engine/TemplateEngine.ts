import {QuickAddEngine} from "./QuickAddEngine";
import {CompleteFormatter} from "../formatters/completeFormatter";
import {App, TAbstractFile, TFile} from "obsidian";
import type QuickAdd from "../main";
import {getTemplater} from "../utility";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import {FILE_NUMBER_REGEX} from "../constants";

export abstract class TemplateEngine extends QuickAddEngine {
    protected formatter: CompleteFormatter;
    protected readonly templater;

    protected constructor(app: App, protected plugin: QuickAdd) {
        super(app);
        this.templater = getTemplater(app);
        this.formatter = new CompleteFormatter(app, plugin);
    }

    public abstract run(): Promise<void> | Promise<string>;

    protected async getOrCreateFolder(folders: string[]): Promise<string> {
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

    protected async getFormattedFilePath(folderPath: string, format: string, promptHeader: string): Promise<string> {
        const formattedName = await this.formatter.formatFileName(format, promptHeader);
        return this.formatFilePath(folderPath, formattedName);
    }

    protected async incrementFileName(fileName: string) {
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

    protected async createFileWithTemplate(filePath: string, templatePath: string) {
        const templateContent: string = await this.getTemplateContent(templatePath);
        const formattedTemplateContent: string = await this.formatter.formatFileContent(templateContent);

        const createdFile: TFile = await this.app.vault.create(filePath, formattedTemplateContent);

        if (this.templater && !this.templater.settings["trigger_on_file_creation"]) {
            await this.templater.templater.overwrite_file_templates(createdFile);
        }

        return createdFile;
    }

    protected async getTemplateContent(templatePath: string): Promise<string> {
        const templateFile: TAbstractFile = this.app.vault.getAbstractFileByPath(templatePath);
        if (!(templateFile instanceof TFile)) return;

        return await this.app.vault.cachedRead(templateFile);
    }
}

