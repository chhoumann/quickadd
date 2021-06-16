import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type {App, TFile} from "obsidian";
import {log} from "../logger/logManager";
import GenericInputPrompt from "../gui/GenericInputPrompt/genericInputPrompt";
import {CaptureChoiceFormatter} from "../formatters/captureChoiceFormatter";
import {appendToCurrentLine} from "../utility";
import {MARKDOWN_FILE_EXTENSION_REGEX, VALUE_SYNTAX} from "../constants";
import type QuickAdd from "../main";
import {QuickAddChoiceEngine} from "./QuickAddChoiceEngine";

export class CaptureChoiceEngine extends QuickAddChoiceEngine {
    choice: ICaptureChoice;
    private formatter: CaptureChoiceFormatter;

    constructor(app: App, plugin: QuickAdd, choice: ICaptureChoice) {
        super(app);
        this.choice = choice;
        this.formatter = new CaptureChoiceFormatter(app, plugin);
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

            if (await this.fileExists(filePath)) {
                const file: TFile = await this.getFileByPath(filePath);
                if (!file) return;

                const fileContent: string = await this.app.vault.read(file);
                const newFileContent: string = await this.formatter.formatContentWithFile(content, this.choice, fileContent, file);

                await this.app.vault.modify(file, newFileContent);
            } else {
                const formattedContent = await this.formatter.formatContent(content, this.choice);
                if (!formattedContent) return;

                const createdFile = await this.createFileWithInput(filePath, formattedContent);

                if (!createdFile) {
                    log.logError(`could not create '${filePath}.'`);
                    return;
                }
            }

            if (this.choice.appendLink)
                appendToCurrentLine(`[[${filePath.replace(MARKDOWN_FILE_EXTENSION_REGEX, '')}]]`, this.app);
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