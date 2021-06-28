import {CompleteFormatter} from "./completeFormatter";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type {App, TFile} from "obsidian";
import {log} from "../logger/logManager";
import type QuickAdd from "../main";
import type {IChoiceExecutor} from "../IChoiceExecutor";
import {getLinesInString, templaterParseTemplate} from "../utility";

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
            const targetRegex = new RegExp(`\s*${this.choice.insertAfter.after}\s*`)
            let fileContentLines: string[] = getLinesInString(this.fileContent);

            const targetPosition = fileContentLines.findIndex(line => targetRegex.test(line));
            if (targetPosition === -1) {
                log.logError("unable to find insert after line in file.")
            }

            if (this.choice.insertAfter?.insertAtEnd) {
                const nextHeaderPositionAfterTargetPosition = fileContentLines.slice(targetPosition + 1).findIndex(line => (/^#+ |---/).test(line))
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

        const frontmatterEndPosition = this.file ? await this.getFrontmatterEndPosition(this.file) : null;
        if (!frontmatterEndPosition)
            return `${formatted}${this.fileContent}`;

        return this.insertTextAfterPositionInBody(formatted, this.fileContent, frontmatterEndPosition);
    }

    private async getFrontmatterEndPosition(file: TFile) {
        const fileCache = await this.app.metadataCache.getFileCache(file);

        if (!fileCache || !fileCache.frontmatter) {
            log.logMessage("could not get frontmatter. Maybe there isn't any.")
            return 0;
        }

        if (fileCache.frontmatter.position)
            return fileCache.frontmatter.position.end.line;

        return 0;
    }

    private insertTextAfterPositionInBody(text: string, body: string, pos: number): string {
        const splitContent = body.split("\n");
        const pre = splitContent.slice(0, pos + 1).join("\n");
        const post = splitContent.slice(pos + 1).join("\n");

        return `${pre}\n${text}${post}`;
    }

}