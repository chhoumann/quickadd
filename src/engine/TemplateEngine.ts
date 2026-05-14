import { QuickAddEngine } from "./QuickAddEngine";
import type { CompleteFormatter } from "../formatters/completeFormatter";
import { FormatterFactory } from "../services/FormatterFactory";
import type { LinkToCurrentFileBehavior } from "../formatters/formatter";
import type { App, TFile } from "obsidian";
import type QuickAdd from "../main";
import { getTemplater } from "../utilityObsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import {
	FolderSelectionService,
	type FolderChoiceOptions,
} from "../services/FolderSelectionService";
import {
	TemplateEvaluator,
	TemplateFileService,
} from "../services/TemplateFileService";

export abstract class TemplateEngine extends QuickAddEngine {
	protected formatter: CompleteFormatter;
	protected readonly templater;
	protected readonly folderSelectionService: FolderSelectionService;
	protected readonly templateFileService: TemplateFileService;

	protected constructor(
		app: App,
		protected plugin: QuickAdd,
		choiceFormatter?: IChoiceExecutor
	) {
		super(app);
		this.templater = getTemplater(app);
		this.formatter = new FormatterFactory(
			app,
			plugin,
		).createCompleteFormatter(choiceFormatter);
		this.folderSelectionService = new FolderSelectionService(
			app,
			this.vaultFileService,
		);
		this.templateFileService = new TemplateFileService(
			app,
			this.vaultFileService,
			this.frontmatterPropertyService,
		);
	}

	public abstract run():
		| Promise<void>
		| Promise<string>
		| Promise<{ file: TFile; content: string }>;

	protected async getOrCreateFolder(
		folders: string[],
		options: FolderChoiceOptions = {},
	): Promise<string> {
		return await this.folderSelectionService.getOrCreateFolder(
			folders,
			options,
		);
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
		return this.vaultFileService.normalizeMarkdownFilePath(folderPath, formattedName);
	}

	protected getTemplateExtension(templatePath: string): string {
		return this.templateFileService.getTemplateExtension(templatePath);
	}

	protected normalizeTemplateFilePath(
		folderPath: string,
		fileName: string,
		templatePath: string
	): string {
		return this.templateFileService.normalizeTemplateFilePath(
			folderPath,
			fileName,
			templatePath,
		);
	}

	protected async createFileWithTemplate(
		filePath: string,
		templatePath: string
	) {
		const templateContent = await this.getTemplateContent(templatePath);
		return await this.templateFileService.createFileWithTemplateContent(
			filePath,
			templateContent,
			new TemplateEvaluator(this.formatter),
		);
	}

	public setLinkToCurrentFileBehavior(behavior: LinkToCurrentFileBehavior) {
		this.formatter.setLinkToCurrentFileBehavior(behavior);
	}



	protected async overwriteFileWithTemplate(
		file: TFile,
		templatePath: string
	) {
		const templateContent = await this.getTemplateContent(templatePath);
		return await this.templateFileService.overwriteFileWithTemplateContent(
			file,
			templateContent,
			new TemplateEvaluator(this.formatter),
		);
	}

	protected async appendToFileWithTemplate(
		file: TFile,
		templatePath: string,
		section: "top" | "bottom"
	) {
		const templateContent = await this.getTemplateContent(templatePath);
		return await this.templateFileService.appendToFileWithTemplateContent(
			file,
			templateContent,
			section,
			new TemplateEvaluator(this.formatter),
		);
	}

	protected async getTemplateContent(templatePath: string): Promise<string> {
		return await this.templateFileService.readTemplateContent(templatePath);
	}
}
