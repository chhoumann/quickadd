import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { TFile } from "obsidian";
import type { App } from "obsidian";
import { log } from "../logger/logManager";
import { CaptureChoiceFormatter } from "../formatters/captureChoiceFormatter";
import {
	appendToCurrentLine,
	openFile,
	replaceTemplaterTemplatesInCreatedFile,
	templaterParseTemplate,
} from "../utilityObsidian";
import { VALUE_SYNTAX } from "../constants";
import type QuickAdd from "../main";
import { QuickAddChoiceEngine } from "./QuickAddChoiceEngine";
import { SingleTemplateEngine } from "./SingleTemplateEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import invariant from "src/utils/invariant";
import merge from "three-way-merge";

export class CaptureChoiceEngine extends QuickAddChoiceEngine {
	choice: ICaptureChoice;
	private formatter: CaptureChoiceFormatter;
	private readonly plugin: QuickAdd;

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: ICaptureChoice,
		private choiceExecutor: IChoiceExecutor
	) {
		super(app);
		this.choice = choice;
		this.plugin = plugin;
		this.formatter = new CaptureChoiceFormatter(
			app,
			plugin,
			choiceExecutor
		);
	}

	async run(): Promise<void> {
		try {
			if (this.choice?.captureToActiveFile) {
				await this.captureToActiveFile();
				return;
			}

			const captureTo = this.choice.captureTo;
			invariant(captureTo, () => {
				return `Invalid capture to for ${this.choice.name}. ${
					captureTo.length === 0
						? "Capture path is empty."
						: `Capture path is not valid: ${captureTo}`
				}`;
			});

			const filePath = await this.formatFilePath(captureTo);
			const content = this.getCaptureContent();

			let getFileAndAddContentFn: typeof this.onFileExists;

			if (await this.fileExists(filePath)) {
				getFileAndAddContentFn = this.onFileExists.bind(
					this
				) as typeof this.onFileExists;
			} else if (this.choice?.createFileIfItDoesntExist?.enabled) {
				getFileAndAddContentFn = this.onCreateFileIfItDoesntExist.bind(
					this
				) as typeof this.onCreateFileIfItDoesntExist;
			} else {
				log.logWarning(
					`The file ${filePath} does not exist and "Create file if it doesn't exist" is disabled.`
				);
				return;
			}

			const { file, content: newFileContent } =
				await getFileAndAddContentFn(filePath, content);

			await this.app.vault.modify(file, newFileContent);

			if (this.choice.appendLink) {
				const markdownLink = this.app.fileManager.generateMarkdownLink(
					file,
					""
				);
				appendToCurrentLine(markdownLink, this.app);
			}

			if (this.choice?.openFile) {
				await openFile(this.app, file, {
					openInNewTab: this.choice.openFileInNewTab.enabled,
					direction: this.choice.openFileInNewTab.direction,
					focus: this.choice.openFileInNewTab.focus,
					mode: this.choice.openFileInMode,
				});
			}
		} catch (e) {
			log.logError(e as string);
		}
	}

	private getCaptureContent(): string {
		let content: string;

		if (!this.choice.format.enabled) content = VALUE_SYNTAX;
		else content = this.choice.format.format;

		if (this.choice.task) content = `- [ ] ${content}\n`;

		return content;
	}

	private async onFileExists(
		filePath: string,
		content: string
	): Promise<{ file: TFile; content: string }> {
		const file: TFile = this.getFileByPath(filePath);
		if (!file) throw new Error("File not found");

		// First format pass...
		const formatted = await this.formatter.formatContentOnly(content);

		const fileContent: string = await this.app.vault.read(file);
		// Second format pass, with the file content... User input (long running) should have been captured during first pass
		// So this pass is to insert the formatted capture value into the file content, depending on the user's settings
		const formattedFileContent: string =
			await this.formatter.formatContentWithFile(
				formatted,
				this.choice,
				fileContent,
				file
			);

		const secondReadFileContent: string = await this.app.vault.read(file);

		let newFileContent = formattedFileContent;
		if (secondReadFileContent !== fileContent) {
			const res = merge(
				secondReadFileContent,
				fileContent,
				formattedFileContent
			);
			invariant(
				!res.isSuccess,
				() =>
					`The file ${filePath} has been modified since the last read.` +
					`\nQuickAdd could not merge the versions two without conflicts, and will not modify the file.` +
					`\nThis is in order to prevent data loss.`
			);

			newFileContent = res.joinedResults() as string;
		}

		return { file, content: newFileContent };
	}

	private async onCreateFileIfItDoesntExist(
		filePath: string,
		content: string
	): Promise<{ file: TFile; content: string }> {
		let fileContent = "";

		if (this.choice.createFileIfItDoesntExist.createWithTemplate) {
			const singleTemplateEngine: SingleTemplateEngine =
				new SingleTemplateEngine(
					this.app,
					this.plugin,
					this.choice.createFileIfItDoesntExist.template,
					this.choiceExecutor
				);

			fileContent = await singleTemplateEngine.run();
		}

		const file: TFile = await this.createFileWithInput(
			filePath,
			fileContent
		);
		await replaceTemplaterTemplatesInCreatedFile(this.app, file);

		const updatedFileContent: string = await this.app.vault.cachedRead(
			file
		);
		const newFileContent: string =
			await this.formatter.formatContentWithFile(
				content,
				this.choice,
				updatedFileContent,
				file
			);

		return { file, content: newFileContent };
	}

	private async formatFilePath(captureTo: string) {
		const formattedCaptureTo: string = await this.formatter.formatFileName(
			captureTo,
			this.choice.name
		);

		return this.normalizeMarkdownFilePath("", formattedCaptureTo);
	}

	private async captureToActiveFile() {
		const activeFile = this.app.workspace.getActiveFile();

		if (!activeFile) {
			log.logError("Cannot capture to active file - no active file.");
			return;
		}

		let content: string = this.getCaptureContent();
		content = await this.formatter.formatContent(content, this.choice);

		if (this.choice.format.enabled) {
			content = await templaterParseTemplate(
				this.app,
				content,
				activeFile
			);
		}

		if (!content) return;

		if (this.choice.prepend) {
			const fileContent: string = await this.app.vault.cachedRead(
				activeFile
			);
			const newFileContent = `${fileContent}${content}`;

			await this.app.vault.modify(activeFile, newFileContent);
		} else {
			appendToCurrentLine(content, this.app);
		}
	}
}
