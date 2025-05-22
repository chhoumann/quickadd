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
import { FILE_NUMBER_REGEX, MARKDOWN_FILE_EXTENSION_REGEX } from "../constants";
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

	protected async incrementFileName(fileName: string) {
		const exec = FILE_NUMBER_REGEX.exec(fileName);
		const numStr =
			exec && typeof exec.at === "function" ? exec?.at(1) : undefined;
		const fileExists = await this.app.vault.adapter.exists(fileName);
		let newFileName = fileName;

		if (fileExists && numStr) {
			const number = parseInt(numStr);
			if (!number)
				throw new Error("detected numbers but couldn't get them.");

			newFileName = newFileName.replace(
				FILE_NUMBER_REGEX,
				`${number + 1}.md`
			);
		} else if (fileExists) {
			newFileName = newFileName.replace(FILE_NUMBER_REGEX, `${1}.md`);
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

			// Create file with raw template content first
			const createdFile: TFile = await this.createFileWithInput(
				filePath,
				templateContent
			);

			// Process Templater commands FIRST
			await replaceTemplaterTemplatesInCreatedFile(this.app, createdFile, true);

			// Then format QuickAdd variables after Templater is done
			const fileContent = await this.app.vault.read(createdFile);
			const formattedContent = await this.formatter.formatFileContent(fileContent);
			
			if (formattedContent !== fileContent) {
				await this.app.vault.modify(createdFile, formattedContent);
			}

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

			// Write raw template content first
			await this.app.vault.modify(file, templateContent);

			// Process Templater commands FIRST
			await replaceTemplaterTemplatesInCreatedFile(this.app, file, true);

			// Then format QuickAdd variables after Templater is done
			const fileContent = await this.app.vault.read(file);
			const formattedContent = await this.formatter.formatFileContent(fileContent);
			
			if (formattedContent !== fileContent) {
				await this.app.vault.modify(file, formattedContent);
			}

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

			// Append raw template content first
			const fileContent: string = await this.app.vault.cachedRead(file);
			const newFileContent: string =
				section === "top"
					? `${templateContent}\n${fileContent}`
					: `${fileContent}\n${templateContent}`;
			await this.app.vault.modify(file, newFileContent);

			// Process Templater commands FIRST
			await replaceTemplaterTemplatesInCreatedFile(this.app, file, true);

			// Then format QuickAdd variables after Templater is done
			const processedContent = await this.app.vault.read(file);
			const formattedContent = await this.formatter.formatFileContent(processedContent);
			
			if (formattedContent !== processedContent) {
				await this.app.vault.modify(file, formattedContent);
			}

			return file;
		} catch (err) {
			reportError(err, "Could not append to file with template");
			return null;
		}
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		let correctTemplatePath: string = templatePath;
		if (!MARKDOWN_FILE_EXTENSION_REGEX.test(templatePath))
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