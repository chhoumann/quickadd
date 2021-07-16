import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type {App} from "obsidian";
import {TFile} from "obsidian";
import {appendToCurrentLine, getAllFolders} from "../utility";
import {
    fileExistsAppendToBottom,
    fileExistsAppendToTop,
    fileExistsDoNothing,
    fileExistsChoices,
    fileExistsOverwriteFile,
    VALUE_SYNTAX
} from "../constants";
import {log} from "../logger/logManager";
import type QuickAdd from "../main";
import {TemplateEngine} from "./TemplateEngine";
import type {IChoiceExecutor} from "../IChoiceExecutor";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";

export class TemplateChoiceEngine extends TemplateEngine {
    public choice: ITemplateChoice;

    constructor(app: App, plugin: QuickAdd, choice: ITemplateChoice, choiceExecutor: IChoiceExecutor) {
        super(app, plugin, choiceExecutor);
        this.choice = choice;
    }

    public async run(): Promise<void> {
        let folderPath: string = "";

        if (this.choice.folder.enabled) {
            folderPath = await this.getFolderPath();
        }

        let filePath;

        if (this.choice.fileNameFormat.enabled) {
            filePath = await this.getFormattedFilePath(folderPath, this.choice.fileNameFormat.format, this.choice.name);
        } else {
            filePath = await this.getFormattedFilePath(folderPath, VALUE_SYNTAX, this.choice.name);
        }

        if (this.choice.incrementFileName)
            filePath = await this.incrementFileName(filePath);

        let createdFile: TFile;
        if (await this.app.vault.adapter.exists(filePath)) {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (!(file instanceof TFile && file.extension === 'md')) {
                log.logError(`'${filePath}' already exists and is not a valid markdown file.`);
                return;
            }

            await this.app.workspace.splitActiveLeaf('vertical').openFile(file);
            const userChoice: string = await GenericSuggester.Suggest(this.app, fileExistsChoices, fileExistsChoices);

            switch (userChoice) {
                case fileExistsAppendToTop:
                    createdFile = await this.appendToFileWithTemplate(file, this.choice.templatePath, 'top');
                    break;
                case fileExistsAppendToBottom:
                    createdFile = await this.appendToFileWithTemplate(file, this.choice.templatePath, 'bottom');
                    break;
                case fileExistsOverwriteFile:
                    createdFile = await this.overwriteFileWithTemplate(file, this.choice.templatePath);
                    break;
                case fileExistsDoNothing:
                default:
                    log.logWarning("File not written to.");
                    return;
            }
        } else {
            createdFile = await this.createFileWithTemplate(filePath, this.choice.templatePath);
            if (!createdFile) {
                log.logWarning(`Could not create file '${filePath}'.`);
                return;
            }
        }

        if (this.choice.appendLink) {
            appendToCurrentLine(this.app.fileManager.generateMarkdownLink(createdFile, ''), this.app);
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

    private async getFolderPath() {
        let folders: string[] = [...this.choice.folder.folders];

        if (this.choice.folder?.chooseWhenCreatingNote) {
            return await this.getOrCreateFolder(await getAllFolders(this.app));
        }

        if (this.choice.folder?.createInSameFolderAsActiveFile) {
            const activeFile: TFile = this.app.workspace.getActiveFile();

            if (!activeFile)
                log.logError("No active file. Cannot create new file.");

            return this.getOrCreateFolder([activeFile.parent.path]);
        }

        return await this.getOrCreateFolder(folders);
    }
}
