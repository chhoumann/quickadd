import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type {App, TFile} from "obsidian";
import {appendToCurrentLine, getAllFolders} from "../utility";
import {MARKDOWN_FILE_EXTENSION_REGEX} from "../constants";
import {log} from "../logger/logManager";
import type QuickAdd from "../main";
import {TemplateEngine} from "./TemplateEngine";
import type {IChoiceExecutor} from "../IChoiceExecutor";

export class TemplateChoiceEngine extends TemplateEngine {
    public choice: ITemplateChoice;

    constructor(app: App, plugin: QuickAdd, choice: ITemplateChoice, choiceExecutor: IChoiceExecutor) {
        super(app, plugin, choiceExecutor);
        this.choice = choice;
    }

    public async run(): Promise<void> {
        try {
            let folderPath: string = "";

            if (this.choice.folder.enabled) {
                let folders: string[] = this.choice.folder.folders;

                if (this.choice.folder?.chooseWhenCreatingNote) {
                    folders = await getAllFolders(this.app);
                }

                folderPath = await this.getOrCreateFolder(folders);
            }

            let filePath;

            if (this.choice.fileNameFormat.enabled) {
                filePath = await this.getFormattedFilePath(folderPath, this.choice.fileNameFormat.format, this.choice.name);
            } else {
                const fileNameValueFormat: string = "{{VALUE}}";
                filePath = await this.getFormattedFilePath(folderPath, fileNameValueFormat, this.choice.name);
            }

            if (this.choice.incrementFileName)
                filePath = await this.incrementFileName(filePath);

            const createdFile: TFile = await this.createFileWithTemplate(filePath, this.choice.templatePath);
            if (!createdFile) {
                log.logWarning(`Could not create file '${filePath}'.`);
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
                    await this.app.workspace
                        .splitActiveLeaf(this.choice.openFileInNewTab.direction)
                        .openFile(createdFile);
                }
            }
        }
        catch (e) {
            log.logError(e.message);
        }
    }
}
