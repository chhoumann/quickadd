import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type {App, TFile} from "obsidian";
import {log} from "../logger/logManager";
import {CaptureChoiceFormatter} from "../formatters/captureChoiceFormatter";
import {
    appendToCurrentLine,
    openFile,
    replaceTemplaterTemplatesInCreatedFile,
    templaterParseTemplate
} from "../utility";
import {VALUE_SYNTAX} from "../constants";
import type QuickAdd from "../main";
import {QuickAddChoiceEngine} from "./QuickAddChoiceEngine";
import {SingleTemplateEngine} from "./SingleTemplateEngine";
import type {IChoiceExecutor} from "../IChoiceExecutor";

export class CaptureChoiceEngine extends QuickAddChoiceEngine {
    choice: ICaptureChoice;
    private formatter: CaptureChoiceFormatter;
    private readonly plugin: QuickAdd;

    constructor(app: App, plugin: QuickAdd, choice: ICaptureChoice, private choiceExecutor: IChoiceExecutor) {
        super(app);
        this.choice = choice;
        this.plugin = plugin;
        this.formatter = new CaptureChoiceFormatter(app, plugin, choiceExecutor);
    }

    async run(): Promise<void> {
        try {
            if (this.choice?.captureToActiveFile) {
                await this.captureToActiveFile();
                return;
            }

            const captureTo = this.choice.captureTo;
            if (!captureTo) {
                log.logError(`Invalid capture to for ${this.choice.name}`);
                return;
            }

            const filePath = await this.getFilePath(captureTo);
            let content = await this.getCaptureContent();
            let file: TFile;

            if (await this.fileExists(filePath)) {
                file = await this.getFileByPath(filePath);
                if (!file) return;

                const fileContent: string = await this.app.vault.read(file);
                const newFileContent: string = await this.formatter.formatContentWithFile(content, this.choice, fileContent, file);

                await this.app.vault.modify(file, newFileContent);
            } else if (this.choice?.createFileIfItDoesntExist?.enabled) {
                let fileContent: string = "";

                if (this.choice.createFileIfItDoesntExist.createWithTemplate) {
                    const singleTemplateEngine: SingleTemplateEngine =
                        new SingleTemplateEngine(this.app, this.plugin, this.choice.createFileIfItDoesntExist.template, this.choiceExecutor);

                    fileContent = await singleTemplateEngine.run();
                }

                file = await this.createFileWithInput(filePath, fileContent);
                await replaceTemplaterTemplatesInCreatedFile(this.app, file);

                const updatedFileContent: string = await this.app.vault.cachedRead(file);
                const newFileContent: string = await this.formatter.formatContentWithFile(content, this.choice, updatedFileContent, file);
                await this.app.vault.modify(file, newFileContent);

            } else {
                log.logWarning(`The file ${filePath} does not exist and "Create file if it doesn't exist" is disabled.`);
                return;
            }

            if (this.choice.appendLink)
                appendToCurrentLine(this.app.fileManager.generateMarkdownLink(file, ''), this.app);

            if (this.choice?.openFile) {
                if (this.choice?.openFileInNewTab.enabled) {
                    await openFile(this.app, file, {direction: this.choice.openFileInNewTab.direction});
                } else {
                    await openFile(this.app, file);
                }
            }
        }
        catch (e) {
            log.logMessage(e);
        }
    }

    private async getCaptureContent(): Promise<string> {
        let content: string;

        if (!this.choice.format.enabled)
            content = VALUE_SYNTAX;
        else
            content = this.choice.format.format;

        if (this.choice.task)
            content = `- [ ] ${content}\n`;

        return content;
    }

    private async getFilePath(captureTo: string) {
        const formattedCaptureTo: string = await this.formatter.formatFileName(captureTo, this.choice.name);
        return this.formatFilePath("", formattedCaptureTo);
    }

    private async captureToActiveFile() {
        const activeFile: TFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            log.logError("Cannot capture to active file - no active file.")
        }

        let content: string = await this.getCaptureContent();
        content = await this.formatter.formatContent(content, this.choice);

        if (this.choice.format.enabled) {
            content = await templaterParseTemplate(this.app, content, activeFile);
        }

        if (!content) return;

        if (this.choice.prepend) {
            const fileContent: string = await this.app.vault.cachedRead(activeFile);
            const newFileContent: string = `${fileContent}${content}`

            await this.app.vault.modify(activeFile, newFileContent);
        } else {
            appendToCurrentLine(content, this.app);
        }
    }
}