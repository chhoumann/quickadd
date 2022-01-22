import {QuickAddEngine} from "./QuickAddEngine";
import {CompleteFormatter} from "../formatters/completeFormatter";
import {App, TAbstractFile, TFile} from "obsidian";
import type QuickAdd from "../main";
import {getTemplater, replaceTemplaterTemplatesInCreatedFile} from "../utility";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import {FILE_NUMBER_REGEX, MARKDOWN_FILE_EXTENSION_REGEX} from "../constants";
import {log} from "../logger/logManager";
import type {IChoiceExecutor} from "../IChoiceExecutor";

export abstract class TemplateEngine extends QuickAddEngine {
    protected formatter: CompleteFormatter;
    protected readonly templater;

    protected constructor(app: App, protected plugin: QuickAdd, choiceFormatter: IChoiceExecutor) {
        super(app);
        this.templater = getTemplater(app);
        this.formatter = new CompleteFormatter(app, plugin, choiceFormatter);
    }

    public abstract run(): Promise<void> | Promise<string> | Promise<{file: TFile, content: string}>;

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
        try {
            const templateContent: string = await this.getTemplateContent(templatePath);

            const formattedTemplateContent: string = await this.formatter.formatFileContent(templateContent);
            const createdFile: TFile = await this.createFileWithInput(filePath, formattedTemplateContent);

            await replaceTemplaterTemplatesInCreatedFile(this.app, createdFile);

            return createdFile;
        }
        catch (e) {
            log.logError(`Could not create file with template. Maybe '${templatePath}' is an invalid template path?`);
            return null;
        }
    }

    protected async overwriteFileWithTemplate(file: TFile, templatePath: string) {
        try {
            const templateContent: string = await this.getTemplateContent(templatePath);

            const formattedTemplateContent: string = await this.formatter.formatFileContent(templateContent);
            await this.app.vault.modify(file, formattedTemplateContent);

            await replaceTemplaterTemplatesInCreatedFile(this.app, file, true);

            return file;
        }
        catch (e) {
            log.logError(e);
            return null;
        }
    }

    protected async appendToFileWithTemplate(file: TFile, templatePath: string, section: 'top' | 'bottom') {
        try {
            const templateContent: string = await this.getTemplateContent(templatePath);

            const formattedTemplateContent: string = await this.formatter.formatFileContent(templateContent);
            const fileContent: string = await this.app.vault.cachedRead(file);
            const newFileContent: string = section === "top" ?
                `${formattedTemplateContent}\n${fileContent}`  :
                `${fileContent}\n${formattedTemplateContent}`
            await this.app.vault.modify(file, newFileContent);

            await replaceTemplaterTemplatesInCreatedFile(this.app, file, true);

            return file;
        }
        catch (e) {
            log.logError(e);
            return null;
        }
    }

    protected async getTemplateContent(templatePath: string): Promise<string> {
        let correctTemplatePath: string = templatePath;
        if (!MARKDOWN_FILE_EXTENSION_REGEX.test(templatePath))
            correctTemplatePath += ".md";

        const templateFile: TAbstractFile = this.app.vault.getAbstractFileByPath(correctTemplatePath);
        if (!(templateFile instanceof TFile)) return;

        return await this.app.vault.cachedRead(templateFile);
    }
}

