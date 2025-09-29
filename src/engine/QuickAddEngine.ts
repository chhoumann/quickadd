import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";
import { log } from "../logger/logManager";
import { coerceYamlValue } from "../utils/yamlValues";

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

	protected normalizeMarkdownFilePath(
		folderPath: string,
		fileName: string
	): string {
		const actualFolderPath: string = folderPath ? `${folderPath}/` : "";
		const formattedFileName: string = fileName.replace(
			MARKDOWN_FILE_EXTENSION_REGEX,
			""
		);
		return `${actualFolderPath}${formattedFileName}.md`;
	}

	protected async fileExists(filePath: string): Promise<boolean> {
		return await this.app.vault.adapter.exists(filePath);
	}

	protected getFileByPath(filePath: string): TFile {
		const file = this.app.vault.getAbstractFileByPath(filePath);

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

	protected async createFileWithInput(
		filePath: string,
		fileContent: string
	): Promise<TFile> {
		const dirMatch = filePath.match(/(.*)[/\\]/);
		let dirName = "";
		if (dirMatch) dirName = dirMatch[1];

		const dir = this.app.vault.getAbstractFileByPath(dirName);

		if (!dir || !(dir instanceof TFolder)) {
			await this.createFolder(dirName);

		}

		return await this.app.vault.create(filePath, fileContent);
	}

	/**
	 * Post-processes the front matter of a newly created file to properly format
	 * template property variables (arrays, objects, etc.) using Obsidian's YAML processor.
	 */
	protected async postProcessFrontMatter(file: TFile, templatePropertyVars: Map<string, unknown>): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
				for (const [key, value] of templatePropertyVars) {
					frontmatter[key] = coerceYamlValue(value);
				}
			});
		} catch (err) {
			log.logError(`Failed to post-process front matter for file ${file.path}: ${err}`);
			// Don't throw - the file was still created successfully
		}
	}
}
