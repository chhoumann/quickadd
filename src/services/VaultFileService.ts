import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";
import { log } from "../logger/logManager";
import { withTemplaterFileCreationSuppressed } from "../utilityObsidian";

export class VaultFileService {
	public constructor(private readonly app: App) {}

	public stripLeadingSlash(path: string): string {
		return path.replace(/^\/+/, "");
	}

	public normalizeMarkdownFilePath(
		folderPath: string,
		fileName: string,
	): string {
		const safeFolderPath = this.stripLeadingSlash(folderPath);
		const actualFolderPath = safeFolderPath ? `${safeFolderPath}/` : "";
		const formattedFileName = this.stripLeadingSlash(fileName).replace(
			MARKDOWN_FILE_EXTENSION_REGEX,
			"",
		);
		return `${actualFolderPath}${formattedFileName}.md`;
	}

	public async fileExists(filePath: string): Promise<boolean> {
		return await this.app.vault.adapter.exists(filePath);
	}

	public getFileByPath(filePath: string): TFile {
		const file = this.app.vault.getAbstractFileByPath(filePath);

		if (!file) {
			log.logError(`${filePath} not found`);
			throw new Error(`${filePath} not found`);
		}

		if (file instanceof TFolder) {
			log.logError(`${filePath} found but it's a folder`);
			throw new Error(`${filePath} found but it's a folder`);
		}

		if (!(file instanceof TFile)) throw new Error(`${filePath} is not a file`);

		return file;
	}

	public async createFolder(folder: string): Promise<void> {
		const folderExists = await this.app.vault.adapter.exists(folder);

		if (!folderExists) {
			await this.app.vault.createFolder(folder);
		}
	}

	public async createFileWithInput(
		filePath: string,
		fileContent: string,
		opts: { suppressTemplaterOnCreate?: boolean } = {},
	): Promise<TFile> {
		const dirMatch = filePath.match(/(.*)[/\\]/);
		const dirName = dirMatch ? dirMatch[1] : "";

		if (dirName) {
			const dir = this.app.vault.getAbstractFileByPath(dirName);

			if (!dir || !(dir instanceof TFolder)) {
				await this.createFolder(dirName);
			}
		}

		const createFile = () => this.app.vault.create(filePath, fileContent);
		const shouldSuppress =
			opts.suppressTemplaterOnCreate && filePath.toLowerCase().endsWith(".md");

		return shouldSuppress
			? await withTemplaterFileCreationSuppressed(this.app, filePath, createFile)
			: await createFile();
	}
}
