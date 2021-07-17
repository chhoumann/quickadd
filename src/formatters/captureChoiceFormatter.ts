import {CompleteFormatter} from "./completeFormatter";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type {App, TFile} from "obsidian";
import {log} from "../logger/logManager";
import type QuickAdd from "../main";
import type {IChoiceExecutor} from "../IChoiceExecutor";
import {escapeRegExp, getLinesInString, templaterParseTemplate} from "../utility";
import {CREATE_IF_NOT_FOUND_BOTTOM, CREATE_IF_NOT_FOUND_TOP} from "../constants";

export class CaptureChoiceFormatter extends CompleteFormatter {
    private choice: ICaptureChoice;
    private file: TFile = null;
    private fileContent: string = "";

    constructor(app: App, plugin: QuickAdd, choiceExecutor: IChoiceExecutor) {
        super(app, plugin, choiceExecutor);
    }

    public async formatContentWithFile(input: string, choice: ICaptureChoice, fileContent: string, file: TFile): Promise<string> {
        this.choice = choice;
        this.file = file;
        this.fileContent = fileContent;
        if (!choice || !file || fileContent === null) return input;

        const formatted = await this.formatFileContent(input);
        const templaterFormatted = templaterParseTemplate(this.app, formatted, this.file);
        if (!templaterFormatted) return formatted;

        return templaterFormatted;
    }

    public async formatContent(input: string, choice: ICaptureChoice): Promise<string> {
        this.choice = choice;
        if(!choice) return input;

        return await this.formatFileContent(input);
    }

    async formatFileContent(input: string): Promise<string> {
        let formatted = await super.formatFileContent(input);
        formatted = this.replaceLinebreakInString(formatted);

        const formattedContentIsEmpty = formatted.trim() === "";
        if (formattedContentIsEmpty) return this.fileContent;

        if (this.choice.prepend)
            return `${this.fileContent}\n${formatted}`

        if (this.choice.insertAfter.enabled) {
            return await this.insertAfterHandler(formatted);
        }

        const frontmatterEndPosition = this.file ? await this.getFrontmatterEndPosition(this.file) : null;
        if (!frontmatterEndPosition)
            return `${formatted}${this.fileContent}`;

        return this.insertTextAfterPositionInBody(formatted, this.fileContent, frontmatterEndPosition);
    }

    private async insertAfterHandler(formatted: string) {
        const targetString: string = await this.format(this.choice.insertAfter.after);
        const targetRegex = new RegExp(`\s*${escapeRegExp(targetString.replace('\\n', ''))}\s*`);
        let fileContentLines: string[] = getLinesInString(this.fileContent);

        const targetPosition = fileContentLines.findIndex(line => targetRegex.test(line));
        const targetNotFound = targetPosition === -1;
        if (targetNotFound) {
            if (this.choice.insertAfter?.createIfNotFound) {
                return await this.createInsertAfterIfNotFound(formatted);
            }

            log.logError("unable to find insert after line in file.")
        }

        if (this.choice.insertAfter?.insertAtEnd) {
            const nextHeaderPositionAfterTargetPosition = fileContentLines
                .slice(targetPosition + 1)
                .findIndex(line => (/^#+ |---/).test(line))
            const foundNextHeader = nextHeaderPositionAfterTargetPosition !== -1;

            if (foundNextHeader) {
                let endOfSectionIndex: number;

                for (let i = nextHeaderPositionAfterTargetPosition + targetPosition; i > targetPosition; i--) {
                    const lineIsNewline: boolean = (/^[\s\n ]*$/).test(fileContentLines[i]);

                    if (!lineIsNewline) {
                        endOfSectionIndex = i;
                        break;
                    }
                }

                if (!endOfSectionIndex) endOfSectionIndex = targetPosition;

                return this.insertTextAfterPositionInBody(formatted, this.fileContent, endOfSectionIndex);
            } else {
                return this.insertTextAfterPositionInBody(formatted, this.fileContent, fileContentLines.length - 1);
            }
        }

        return this.insertTextAfterPositionInBody(formatted, this.fileContent, targetPosition);
    }

    private async createInsertAfterIfNotFound(formatted: string) {
        const insertAfterLine: string = this.replaceLinebreakInString(await this.format(this.choice.insertAfter.after));
        const insertAfterLineAndFormatted: string = `${insertAfterLine}\n${formatted}`;

        if (this.choice.insertAfter?.createIfNotFoundLocation === CREATE_IF_NOT_FOUND_TOP) {
            const frontmatterEndPosition = this.file ? await this.getFrontmatterEndPosition(this.file) : -1;
            return this.insertTextAfterPositionInBody(insertAfterLineAndFormatted, this.fileContent, frontmatterEndPosition);
        }

        if (this.choice.insertAfter?.createIfNotFoundLocation === CREATE_IF_NOT_FOUND_BOTTOM) {
            return `${this.fileContent}\n${insertAfterLineAndFormatted}`;
        }
    }

    private async getFrontmatterEndPosition(file: TFile) {
        const fileCache = await this.app.metadataCache.getFileCache(file);

        if (!fileCache || !fileCache.frontmatter) {
            log.logMessage("could not get frontmatter. Maybe there isn't any.")
            return -1;
        }

        if (fileCache.frontmatter.position)
            return fileCache.frontmatter.position.end.line;

        return -1;
    }

    private insertTextAfterPositionInBody(text: string, body: string, pos: number): string {
        if (pos === -1) {
            return `${text}\n${body}`;
        }

        const splitContent = body.split("\n");
        const pre = splitContent.slice(0, pos + 1).join("\n");
        const post = splitContent.slice(pos + 1).join("\n");

        return `${pre}\n${text}${post}`;
    }

}