import { QuickAddEngine } from "./QuickAddEngine";
import { CompleteFormatter } from "../formatters/completeFormatter";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import type QuickAdd from "../main";
import {
	getTemplater,
	replaceTemplaterTemplatesInCreatedFile,
} from "../utilityObsidian";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import { FILE_NUMBER_REGEX, MARKDOWN_FILE_EXTENSION_REGEX, CANVAS_FILE_EXTENSION_REGEX } from "../constants";
import { reportError } from "../utils/errorUtils";
import type { IChoiceExecutor } from "../IChoiceExecutor";

export abstract class TemplateEngine extends QuickAddEngine {
	protected formatter: CompleteFormatter;
	protected readonly templater;

	protected constructor(
		app: App,
		protected plugin: QuickAdd,
		choiceFormatter?: IChoiceExecutor
	) {
		super(app);
		this.templater = getTemplater(app);
		this.formatter = new CompleteFormatter(app, plugin, choiceFormatter);
	}

	public abstract run():
		| Promise<void>
		| Promise<string>
		| Promise<{ file: TFile; content: string }>;

	protected async getOrCreateFolder(folders: string[]): Promise<string> {
		let folderPath: string;

		if (folders.length > 1) {
			folderPath = await GenericSuggester.Suggest(
				this.app,
				folders,
				folders
			);
			if (!folderPath) throw new Error("No folder selected.");
		} else {
			folderPath = folders[0];
		}

		if (folderPath) await this.createFolder(folderPath);
		else folderPath = "";

		return folderPath;
	}

	protected async getFormattedFilePath(
		folderPath: string,
		format: string,
		promptHeader: string
	): Promise<string> {
		const formattedName = await this.formatter.formatFileName(
			format,
			promptHeader
		);
		return this.normalizeMarkdownFilePath(folderPath, formattedName);
	}

	protected getTemplateExtension(templatePath: string): string {
		if (CANVAS_FILE_EXTENSION_REGEX.test(templatePath)) {
			return ".canvas";
		}
		return ".md";
	}

	protected normalizeTemplateFilePath(
		folderPath: string,
		fileName: string,
		templatePath: string
	): string {
		const actualFolderPath: string = folderPath ? `${folderPath}/` : "";
		const extension = this.getTemplateExtension(templatePath);
		const formattedFileName: string = fileName.replace(
			MARKDOWN_FILE_EXTENSION_REGEX,
			""
		).replace(CANVAS_FILE_EXTENSION_REGEX, "");
		return `${actualFolderPath}${formattedFileName}${extension}`;
	}

	protected async incrementFileName(fileName: string) {
		const exec = FILE_NUMBER_REGEX.exec(fileName);
		const numStr =
			exec && typeof exec.at === "function" ? exec?.at(1) : undefined;
		const fileExists = await this.app.vault.adapter.exists(fileName);
		let newFileName = fileName;

		// Determine the extension from the filename
		const extension = CANVAS_FILE_EXTENSION_REGEX.test(fileName) ? ".canvas" : ".md";

		if (fileExists && numStr) {
			const number = parseInt(numStr);
			if (!number)
				throw new Error("detected numbers but couldn't get them.");

			newFileName = newFileName.replace(
				FILE_NUMBER_REGEX,
				`${number + 1}${extension}`
			);
		} else if (fileExists) {
			newFileName = newFileName.replace(FILE_NUMBER_REGEX, `${1}${extension}`);
		}

		const newFileExists = await this.app.vault.adapter.exists(newFileName);
		if (newFileExists)
			newFileName = await this.incrementFileName(newFileName);

		return newFileName;
	}

	protected async createFileWithTemplate(
		filePath: string,
		templatePath: string
	) {
		try {
			const templateContent: string = await this.getTemplateContent(
				templatePath
			);

			const formattedTemplateContent: string =
				await this.formatter.formatFileContent(templateContent);
			const createdFile: TFile = await this.createFileWithInput(
				filePath,
				formattedTemplateContent
			);

			// Process Templater commands for template choices
			await replaceTemplaterTemplatesInCreatedFile(this.app, createdFile);

			return createdFile;
		} catch (err) {
			reportError(err, "Could not create file with template");
			return null;
		}
	}

	protected async overwriteFileWithTemplate(
		file: TFile,
		templatePath: string
	) {
		try {
			const templateContent: string = await this.getTemplateContent(
				templatePath
			);

			const formattedTemplateContent: string =
				await this.formatter.formatFileContent(templateContent);
			await this.app.vault.modify(file, formattedTemplateContent);

			// Process Templater commands
			await replaceTemplaterTemplatesInCreatedFile(this.app, file);

			return file;
		} catch (err) {
			reportError(err, "Could not overwrite file with template");
			return null;
		}
	}

	protected async appendToFileWithTemplate(
		file: TFile,
		templatePath: string,
		section: "top" | "bottom"
	) {
		try {
			const templateContent: string = await this.getTemplateContent(
				templatePath
			);

			const formattedTemplateContent: string =
				await this.formatter.formatFileContent(templateContent);
			const fileContent: string = await this.app.vault.cachedRead(file);
			const newFileContent: string =
				section === "top"
					? `${formattedTemplateContent}\n${fileContent}`
					: `${fileContent}\n${formattedTemplateContent}`;
			await this.app.vault.modify(file, newFileContent);

			// Process Templater commands
			await replaceTemplaterTemplatesInCreatedFile(this.app, file);

			return file;
		} catch (err) {
			reportError(err, "Could not append to file with template");
			return null;
		}
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		let correctTemplatePath: string = templatePath;
		if (!MARKDOWN_FILE_EXTENSION_REGEX.test(templatePath) && 
			!CANVAS_FILE_EXTENSION_REGEX.test(templatePath))
			correctTemplatePath += ".md";

		const templateFile =
			this.app.vault.getAbstractFileByPath(correctTemplatePath);

		if (!(templateFile instanceof TFile))
			throw new Error(
				`Template file not found at path "${correctTemplatePath}".`
			);

		return await this.app.vault.cachedRead(templateFile);
	}
}