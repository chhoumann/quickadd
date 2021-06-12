import {CompleteFormatter} from "./completeFormatter";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type {App, TFile} from "obsidian";
import {log} from "../logger/logManager";

export class CaptureChoiceFormatter extends CompleteFormatter {
    private choice: ICaptureChoice;
    private file: TFile;
    private fileContent: string;

    constructor(app: App) {
        super(app);
    }

    public async formatContent(input: string, choice: ICaptureChoice, fileContent: string, file: TFile): Promise<string> {
        this.choice = choice;
        this.file = file;
        this.fileContent = fileContent;
        if (!choice || !file || fileContent === null) return input;

        return await this.formatFileContent(input);
    }

    async formatFileContent(input: string): Promise<string> {
        const formatted = await super.formatFileContent(input);

        if (this.choice.prepend)
            return `${this.fileContent}\n${input}`

        if (this.choice.insertAfter.enabled) {
            const targetRegex = new RegExp(`\s*${this.choice.insertAfter.after}\s*`)
            const targetPosition = this.fileContent.split("\n").findIndex(line => targetRegex.test(line));
            if (!targetPosition) {
                log.logError(`unable to find insert after line in file.`);
                return formatted;
            }

            return this.insertTextAfterPositionInBody(formatted, this.fileContent, targetPosition);
        }

        const frontmatterEndPosition = await this.getFrontmatterEndPosition(this.file);
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