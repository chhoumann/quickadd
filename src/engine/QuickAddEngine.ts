import type {App} from "obsidian";
import {TAbstractFile, TFile, TFolder} from "obsidian";
import {MARKDOWN_FILE_EXTENSION_REGEX} from "../constants";
import {log} from "../logger/logManager";

export abstract class QuickAddEngine {
    public app: App;

    protected constructor(app: App) {
        this.app = app;
    }

    public abstract run(): void;

    protected async createFolder(folder: string): Promise<void> {
        const folderExists = await this.app.vault.adapter.exists(folder);

        if (!folderExists) {
            await this.app.vault.createFolder(folder);
        }
    }

    protected formatFilePath(folderPath: string, fileName: string): string {
        const actualFolderPath: string = folderPath ? `${folderPath}/` : "";
        const formattedFileName: string = fileName.replace(MARKDOWN_FILE_EXTENSION_REGEX, '');
        return `${actualFolderPath}${formattedFileName}.md`;
    }

    protected async fileExists(filePath: string): Promise<boolean> {
        return await this.app.vault.adapter.exists(filePath);
    }

    protected async getFileByPath(filePath: string): Promise<TFile> {
        const file = await this.app.vault.getAbstractFileByPath(filePath);

        if (!file) {
            log.logError(`${filePath} not found`);
            throw new Error(`${filePath} not found`);
        }

        if (file instanceof TFolder) {
            log.logError(`${filePath} found but it's a folder`);
            throw new Error(`${filePath} found but it's a folder`);
        }

        if (!(file instanceof TFile))
            throw new Error(`${filePath} is not a file`);

        return file;
    }

    protected async createFileWithInput(filePath: string, fileContent: string): Promise<TFile> {
        const dirMatch = filePath.match(/(.*)[\/\\]/);
        let dirName = "";
        if (dirMatch) dirName = dirMatch[1];

        if (await this.app.vault.adapter.exists(dirName)) {
            return await this.app.vault.create(filePath, fileContent);
        } else {
            await this.createFolder(dirName);
            return await this.app.vault.create(filePath, fileContent)
        }
    }
}

