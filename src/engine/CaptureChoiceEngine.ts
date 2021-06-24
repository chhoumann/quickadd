import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type {App, TFile} from "obsidian";
import {log} from "../logger/logManager";
import {CaptureChoiceFormatter} from "../formatters/captureChoiceFormatter";
import {appendToCurrentLine, replaceTemplaterTemplatesInCreatedFile} from "../utility";
import {MARKDOWN_FILE_EXTENSION_REGEX, VALUE_SYNTAX} from "../constants";
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
                const singleTemplateEngine: SingleTemplateEngine =
                    new SingleTemplateEngine(this.app, this.plugin, this.choice.createFileIfItDoesntExist.template, this.choiceExecutor);

                const fileContent: string = await singleTemplateEngine.run();
                const file: TFile = await this.createFileWithInput(filePath, fileContent);
                await replaceTemplaterTemplatesInCreatedFile(this.app, file);

                const updatedFileContent: string = await this.app.vault.cachedRead(file);
                const newFileContent: string = await this.formatter.formatContentWithFile(content, this.choice, updatedFileContent, file);
                await this.app.vault.modify(file, newFileContent);

            } else {
                const formattedContent = await this.formatter.formatContent(content, this.choice);
                if (!formattedContent) return;

                file = await this.createFileWithInput(filePath, formattedContent);

                if (!file) {
                    log.logError(`could not create '${filePath}.'`);
                    return;
                }
            }

            if (this.choice.appendLink)
                appendToCurrentLine(this.app.fileManager.generateMarkdownLink(file, ''), this.app);
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
        let content: string = await this.getCaptureContent();

        if (this.choice.format.enabled) {
            content = await this.formatter.formatContent(content, this.choice);
        }

        if (!content) return;
        appendToCurrentLine(content, this.app);
    }
}