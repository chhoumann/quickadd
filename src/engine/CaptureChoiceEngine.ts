import {QuickAddEngine} from "./QuickAddEngine";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type {App, TFile} from "obsidian";
import {log} from "../logger/logManager";
import GenericInputPrompt from "../gui/GenericInputPrompt/genericInputPrompt";
import {CaptureChoiceFormatter} from "../formatters/captureChoiceFormatter";
import {appendToCurrentLine} from "../utility";
import {MARKDOWN_FILE_EXTENSION_REGEX} from "../constants";

export class CaptureChoiceEngine extends QuickAddEngine {
    choice: ICaptureChoice;
    private formatter: CaptureChoiceFormatter;

    constructor(app: App, choice: ICaptureChoice) {
        super(app);
        this.choice = choice;
        this.formatter = new CaptureChoiceFormatter(app);
    }

    async run(): Promise<void> {
        const captureTo = this.choice.captureTo;
        if (!captureTo) {
            log.logError(`Invalid capture to for ${this.choice.name}`);
            return;
        }

        const filePath = await this.getFilePath(captureTo);
        let content: string;

        if (!this.choice.format.enabled)
            content = await GenericInputPrompt.Prompt(this.app, this.choice.name);
        else
            content = this.choice.format.format;

        if (this.choice.task)
            content = `- [ ] ${content}`;

        if (await this.fileExists(filePath)) {
            const file: TFile = await this.getFileByPath(filePath);
            if (!file) return;

            const fileContent: string = await this.app.vault.read(file);
            const newFileContent: string = await this.formatter.formatContent(content, this.choice, fileContent, file);

            await this.app.vault.modify(file, newFileContent);
        } else {
            const createdFile = await this.createFileWithInput(filePath, content);
            if (!createdFile) {
                log.logError(`could not create '${filePath}.'`);
                return;
            }
        }

        if (this.choice.appendLink)
            appendToCurrentLine(`[[${filePath.replace(MARKDOWN_FILE_EXTENSION_REGEX, '')}]]`, this.app);
    }

    private async getFilePath(captureTo: string) {
        const formattedCaptureTo: string = await this.formatter.formatFileName(captureTo, this.choice.name);
        return this.formatFilePath("", formattedCaptureTo);
    }

}