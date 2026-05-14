import type { App } from "obsidian";
import { TFile } from "obsidian";
import {
	BASE_FILE_EXTENSION_REGEX,
	CANVAS_FILE_EXTENSION_REGEX,
	MARKDOWN_FILE_EXTENSION_REGEX,
} from "../constants";
import { MacroAbortError } from "../errors/MacroAbortError";
import type { CompleteFormatter } from "../formatters/completeFormatter";
import { log } from "../logger/logManager";
import { reportError } from "../utils/errorUtils";
import { basenameWithoutMdOrCanvas } from "../utils/pathUtils";
import {
	overwriteTemplaterOnce,
	templaterParseTemplate,
} from "../utilityObsidian";
import { FrontmatterPropertyService } from "./FrontmatterPropertyService";
import { VaultFileService } from "./VaultFileService";

export type TemplateEvaluationResult = {
	content: string;
	templatePropertyVars: Map<string, unknown>;
};

export class TemplateEvaluator {
	public constructor(private readonly formatter: CompleteFormatter) {}

	public async evaluateTemplateContent(
		templateContent: string,
		targetPath: string,
	): Promise<TemplateEvaluationResult> {
		const fileBasename = basenameWithoutMdOrCanvas(targetPath);
		this.formatter.setTitle(fileBasename);

		const content = await this.formatter.withTemplatePropertyCollection(() =>
			this.formatter.formatFileContent(templateContent),
		);
		const templatePropertyVars =
			this.formatter.getAndClearTemplatePropertyVars();

		return { content, templatePropertyVars };
	}

	public async evaluateTemplateContentForAppend(
		templateContent: string,
		targetPath: string,
	): Promise<string> {
		const fileBasename = basenameWithoutMdOrCanvas(targetPath);
		this.formatter.setTitle(fileBasename);

		return await this.formatter.formatFileContent(templateContent);
	}
}

function isMacroAbortError(error: unknown): error is MacroAbortError {
	return (
		error instanceof MacroAbortError ||
		(Boolean(error) &&
			typeof error === "object" &&
			"name" in (error as Record<string, unknown>) &&
			(error as { name?: string }).name === "MacroAbortError")
	);
}

export class TemplateFileService {
	public constructor(
		private readonly app: App,
		private readonly vaultFileService = new VaultFileService(app),
		private readonly frontmatterPropertyService =
			new FrontmatterPropertyService(app),
	) {}

	public normalizeTemplatePath(templatePath: string): string {
		let correctTemplatePath =
			this.vaultFileService.stripLeadingSlash(templatePath);
		if (
			!MARKDOWN_FILE_EXTENSION_REGEX.test(templatePath) &&
			!CANVAS_FILE_EXTENSION_REGEX.test(templatePath) &&
			!BASE_FILE_EXTENSION_REGEX.test(templatePath)
		) {
			correctTemplatePath += ".md";
		}
		return correctTemplatePath;
	}

	public getTemplateFile(templatePath: string): TFile {
		const correctTemplatePath = this.normalizeTemplatePath(templatePath);
		const templateFile =
			this.app.vault.getAbstractFileByPath(correctTemplatePath);

		if (!(templateFile instanceof TFile)) {
			throw new Error(
				`Template file not found at path "${correctTemplatePath}".`,
			);
		}

		return templateFile;
	}

	public async readTemplateContent(templatePath: string): Promise<string> {
		return await this.app.vault.cachedRead(this.getTemplateFile(templatePath));
	}

	public getTemplateExtension(templatePath: string): string {
		if (CANVAS_FILE_EXTENSION_REGEX.test(templatePath)) {
			return ".canvas";
		}
		if (BASE_FILE_EXTENSION_REGEX.test(templatePath)) {
			return ".base";
		}
		return ".md";
	}

	public normalizeTemplateFilePath(
		folderPath: string,
		fileName: string,
		templatePath: string,
	): string {
		const safeFolderPath = this.vaultFileService.stripLeadingSlash(folderPath);
		const actualFolderPath = safeFolderPath ? `${safeFolderPath}/` : "";
		const extension = this.getTemplateExtension(templatePath);
		const formattedFileName = this.vaultFileService
			.stripLeadingSlash(fileName)
			.replace(MARKDOWN_FILE_EXTENSION_REGEX, "")
			.replace(CANVAS_FILE_EXTENSION_REGEX, "")
			.replace(BASE_FILE_EXTENSION_REGEX, "");
		return `${actualFolderPath}${formattedFileName}${extension}`;
	}

	public async previewTemplateContent(templatePath: string): Promise<string> {
		try {
			return await this.readTemplateContent(templatePath);
		} catch {
			return `Template (not found): ${templatePath}`;
		}
	}

	public async createFileWithTemplate(
		filePath: string,
		templatePath: string,
		evaluator: TemplateEvaluator,
	): Promise<TFile | null> {
		try {
			const templateContent = await this.readTemplateContent(templatePath);
			return await this.createFileWithTemplateContent(
				filePath,
				templateContent,
				evaluator,
			);
		} catch (err) {
			if (isMacroAbortError(err)) throw err;
			reportError(err, `Could not create file with template at ${filePath}`);
			return null;
		}
	}

	public async createFileWithTemplateContent(
		filePath: string,
		templateContent: string,
		evaluator: TemplateEvaluator,
	): Promise<TFile | null> {
		try {
			const { content, templatePropertyVars } =
				await evaluator.evaluateTemplateContent(templateContent, filePath);

			this.logCollectedVars(
				"TemplateFileService.createFileWithTemplate",
				filePath,
				templatePropertyVars,
			);

			const suppressTemplaterOnCreate = filePath
				.toLowerCase()
				.endsWith(".md");
			const createdFile = await this.vaultFileService.createFileWithInput(
				filePath,
				content,
				{ suppressTemplaterOnCreate },
			);

			if (
				this.frontmatterPropertyService.shouldPostProcessFrontMatter(
					createdFile,
					templatePropertyVars,
				)
			) {
				await this.frontmatterPropertyService.postProcessFrontMatter(
					createdFile,
					templatePropertyVars,
				);
			}

			await overwriteTemplaterOnce(this.app, createdFile);

			return createdFile;
		} catch (err) {
			if (isMacroAbortError(err)) throw err;
			reportError(err, `Could not create file with template at ${filePath}`);
			return null;
		}
	}

	public async overwriteFileWithTemplate(
		file: TFile,
		templatePath: string,
		evaluator: TemplateEvaluator,
	): Promise<TFile | null> {
		try {
			const templateContent = await this.readTemplateContent(templatePath);
			return await this.overwriteFileWithTemplateContent(
				file,
				templateContent,
				evaluator,
			);
		} catch (err) {
			if (isMacroAbortError(err)) throw err;
			reportError(err, "Could not overwrite file with template");
			return null;
		}
	}

	public async overwriteFileWithTemplateContent(
		file: TFile,
		templateContent: string,
		evaluator: TemplateEvaluator,
	): Promise<TFile | null> {
		try {
			const { content, templatePropertyVars } =
				await evaluator.evaluateTemplateContent(templateContent, file.path);

			this.logCollectedVars(
				"TemplateFileService.overwriteFileWithTemplate",
				file.path,
				templatePropertyVars,
			);

			await this.app.vault.modify(file, content);

			if (
				this.frontmatterPropertyService.shouldPostProcessFrontMatter(
					file,
					templatePropertyVars,
				)
			) {
				await this.frontmatterPropertyService.postProcessFrontMatter(
					file,
					templatePropertyVars,
				);
			}

			await overwriteTemplaterOnce(this.app, file);

			return file;
		} catch (err) {
			if (isMacroAbortError(err)) throw err;
			reportError(err, "Could not overwrite file with template");
			return null;
		}
	}

	public async appendToFileWithTemplate(
		file: TFile,
		templatePath: string,
		section: "top" | "bottom",
		evaluator: TemplateEvaluator,
	): Promise<TFile | null> {
		try {
			const templateContent = await this.readTemplateContent(templatePath);
			return await this.appendToFileWithTemplateContent(
				file,
				templateContent,
				section,
				evaluator,
			);
		} catch (err) {
			if (isMacroAbortError(err)) throw err;
			reportError(err, "Could not append to file with template");
			return null;
		}
	}

	public async appendToFileWithTemplateContent(
		file: TFile,
		templateContent: string,
		section: "top" | "bottom",
		evaluator: TemplateEvaluator,
	): Promise<TFile | null> {
		try {
			let content = await evaluator.evaluateTemplateContentForAppend(
				templateContent,
				file.path,
			);
			if (file.extension === "md") {
				content = await templaterParseTemplate(this.app, content, file);
			}
			const fileContent = await this.app.vault.cachedRead(file);
			const newFileContent =
				section === "top"
					? `${content}\n${fileContent}`
					: `${fileContent}\n${content}`;
			await this.app.vault.modify(file, newFileContent);

			return file;
		} catch (err) {
			if (isMacroAbortError(err)) throw err;
			reportError(err, "Could not append to file with template");
			return null;
		}
	}

	private logCollectedVars(
		scope: string,
		filePath: string,
		templateVars: Map<string, unknown>,
	): void {
		log.logMessage(
			`${scope}: Collected ${templateVars.size} template property variables for ${filePath}`,
		);
		if (templateVars.size > 0) {
			log.logMessage(`Variables: ${Array.from(templateVars.keys()).join(", ")}`);
		}
	}
}
