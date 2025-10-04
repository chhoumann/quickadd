import { QuickAddEngine } from "./QuickAddEngine";
import { CompleteFormatter } from "../formatters/completeFormatter";
import type { LinkToCurrentFileBehavior } from "../formatters/formatter";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import type QuickAdd from "../main";
import {
	getTemplater,
	overwriteTemplaterOnce,
} from "../utilityObsidian";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import { MARKDOWN_FILE_EXTENSION_REGEX, CANVAS_FILE_EXTENSION_REGEX } from "../constants";
import { reportError } from "../utils/errorUtils";
import { basenameWithoutMdOrCanvas } from "../utils/pathUtils";
import { MacroAbortError } from "../errors/MacroAbortError";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";

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
			try {
				folderPath = await GenericSuggester.Suggest(
					this.app,
					folders,
					folders
				);
				if (!folderPath) throw new Error("No folder selected.");
			} catch (error) {
				// Always abort on cancelled input
				throw new MacroAbortError("Input cancelled by user");
			}
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
		const fileExists = await this.app.vault.adapter.exists(fileName);
		let newFileName = fileName;

		// Determine the extension from the filename and construct a matching regex
		const extension = CANVAS_FILE_EXTENSION_REGEX.test(fileName) ? ".canvas" : ".md";
		const extPattern = extension.replace(/\./g, "\\.");
		const numberWithExtRegex = new RegExp(`(\\d*)${extPattern}$`);
		const exec = numberWithExtRegex.exec(fileName);
		const numStr = exec?.[1];

		if (fileExists && numStr !== undefined) {
			if (numStr.length > 0) {
				const number = parseInt(numStr, 10);
				if (Number.isNaN(number)) {
					throw new Error("detected numbers but couldn't get them.");
				}
				newFileName = newFileName.replace(numberWithExtRegex, `${number + 1}${extension}`);
			} else {
				// No digits previously; insert 1 before extension
				newFileName = newFileName.replace(new RegExp(`${extPattern}$`), `1${extension}`);
			}
		} else if (fileExists) {
			// No match; simply append 1 before the extension
			newFileName = newFileName.replace(new RegExp(`${extPattern}$`), `1${extension}`);
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

				// Extract filename without extension from the full path (supports .md and .canvas)
				const fileBasename = basenameWithoutMdOrCanvas(filePath);
			this.formatter.setTitle(fileBasename);

			const formattedTemplateContent: string =
				await this.formatter.formatFileContent(templateContent);

			// Get template variables before creating the file
			const templateVars = this.formatter.getAndClearTemplatePropertyVars();

			log.logMessage(`TemplateEngine.createFileWithTemplate: Collected ${templateVars.size} template property variables for ${filePath}`);
			if (templateVars.size > 0) {
				log.logMessage(`Variables: ${Array.from(templateVars.keys()).join(', ')}`);
			}

			const createdFile: TFile = await this.createFileWithInput(
				filePath,
				formattedTemplateContent
			);

			// Post-process front matter for template property types BEFORE Templater
			if (this.shouldPostProcessFrontMatter(createdFile, templateVars)) {
				await this.postProcessFrontMatter(createdFile, templateVars);
			}

			// Process Templater commands for template choices
			await overwriteTemplaterOnce(this.app, createdFile);

			return createdFile;
		} catch (err) {
			reportError(err, `Could not create file with template at ${filePath}`);
			return null;
		}
	}

	public setLinkToCurrentFileBehavior(behavior: LinkToCurrentFileBehavior) {
		this.formatter.setLinkToCurrentFileBehavior(behavior);
	}



	protected async overwriteFileWithTemplate(
		file: TFile,
		templatePath: string
	) {
		try {
			const templateContent: string = await this.getTemplateContent(
				templatePath
			);

			// Use the existing file's basename as the title
			const fileBasename = file.basename;
			this.formatter.setTitle(fileBasename);

			const formattedTemplateContent: string =
				await this.formatter.formatFileContent(templateContent);

			// Get template variables before modifying the file
			const templateVars = this.formatter.getAndClearTemplatePropertyVars();

			log.logMessage(`TemplateEngine.overwriteFileWithTemplate: Collected ${templateVars.size} template property variables for ${file.path}`);
			if (templateVars.size > 0) {
				log.logMessage(`Variables: ${Array.from(templateVars.keys()).join(', ')}`);
			}

			await this.app.vault.modify(file, formattedTemplateContent);

			// Post-process front matter for template property types BEFORE Templater
			if (this.shouldPostProcessFrontMatter(file, templateVars)) {
				await this.postProcessFrontMatter(file, templateVars);
			}

			// Process Templater commands
			await overwriteTemplaterOnce(this.app, file);

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

			// Use the existing file's basename as the title
			const fileBasename = file.basename;
			this.formatter.setTitle(fileBasename);

			const formattedTemplateContent: string =
				await this.formatter.formatFileContent(templateContent);
			const fileContent: string = await this.app.vault.cachedRead(file);
			const newFileContent: string =
				section === "top"
					? `${formattedTemplateContent}\n${fileContent}`
					: `${fileContent}\n${formattedTemplateContent}`;
			await this.app.vault.modify(file, newFileContent);

			// Process Templater commands
			await overwriteTemplaterOnce(this.app, file);

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
