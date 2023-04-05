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
	isFolder,
	getMarkdownFilesInFolder,
	getMarkdownFilesWithTag,
} from "../utilityObsidian";
import { VALUE_SYNTAX } from "../constants";
import type QuickAdd from "../main";
import { QuickAddChoiceEngine } from "./QuickAddChoiceEngine";
import { SingleTemplateEngine } from "./SingleTemplateEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import invariant from "src/utils/invariant";
import merge from "three-way-merge";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import GenericSuggester from "src/gui/GenericSuggester/genericSuggester";

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
			const filePath = await this.getFormattedPathToCaptureTo(
				this.choice.captureToActiveFile
			);
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

			const { file, newFileContent, captureContent } =
				await getFileAndAddContentFn(filePath, content);

			if (this.choice.captureToActiveFile && !this.choice.prepend) {
				// Parse Templater syntax in the capture content.
				// If Templater isn't installed, it just returns the capture content.
				const content = await templaterParseTemplate(
					app,
					captureContent,
					file
				);

				appendToCurrentLine(content, this.app);
			} else {
				await this.app.vault.modify(file, newFileContent);
			}

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

	/**
	 * Gets a formatted file path to capture content to, either the active file or a specified location.
	 * If capturing to a folder, suggests a file within the folder to capture the content to.
	 *
	 * @param {boolean} shouldCaptureToActiveFile - Determines if the content should be captured to the active file.
	 * @returns {Promise<string>} A promise that resolves to the formatted file path where the content should be captured.
	 *
	 * @throws {Error} Throws an error if there's no active file when trying to capture to active file,
	 *                 if the capture path is invalid, or if the target folder is empty.
	 */
	private async getFormattedPathToCaptureTo(
		shouldCaptureToActiveFile: boolean
	): Promise<string> {
		if (shouldCaptureToActiveFile) {
			const activeFile = this.app.workspace.getActiveFile();
			invariant(
				activeFile,
				`Cannot capture to active file - no active file.`
			);

			return activeFile.path;
		}

		const captureTo = this.choice.captureTo;
		const formattedCaptureTo = await this.formatFilePath(captureTo);

		// Removing the trailing slash from the capture to path because otherwise isFolder will fail
		// to get the folder.
		const folderPath = formattedCaptureTo.replace(
			/^\/$|\/\.md$|^\.md$/,
			""
		);
		// Empty string means we suggest to capture anywhere in the vault.
		const captureAnywhereInVault = folderPath === "";
		const shouldCaptureToFolder =
			captureAnywhereInVault || isFolder(folderPath);
		const shouldCaptureWithTag = formattedCaptureTo.startsWith("#");

		if (shouldCaptureToFolder) {
			return this.selectFileInFolder(folderPath, captureAnywhereInVault);
		}

		if (shouldCaptureWithTag) {
			const tag = formattedCaptureTo.replace(/\.md$/, "");
			return this.selectFileWithTag(tag);
		}

		return formattedCaptureTo;
	}

	private async selectFileInFolder(
		folderPath: string,
		captureAnywhereInVault: boolean
	): Promise<string> {
		const folderPathSlash =
			folderPath.endsWith("/") || captureAnywhereInVault
				? folderPath
				: `${folderPath}/`;
		const filesInFolder = getMarkdownFilesInFolder(folderPathSlash);

		invariant(
			filesInFolder.length > 0,
			`Folder ${folderPathSlash} is empty.`
		);

		const filePaths = filesInFolder.map((f) => f.path);
		const targetFilePath = await InputSuggester.Suggest(
			app,
			filePaths.map((item) => item.replace(folderPathSlash, "")),
			filePaths
		);

		invariant(
			!!targetFilePath && targetFilePath.length > 0,
			`No file selected for capture.`
		);

		// Ensure user has selected a file in target folder. InputSuggester allows user to write
		// their own file path, so we need to make sure it's in the target folder.
		const filePath = targetFilePath.startsWith(`${folderPathSlash}/`)
			? targetFilePath
			: `${folderPathSlash}/${targetFilePath}`;

		return await this.formatFilePath(filePath);
	}

	private async selectFileWithTag(tag: string): Promise<string> {
		const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
		const filesWithTag = getMarkdownFilesWithTag(tagWithHash);

		invariant(filesWithTag.length > 0, `No files with tag ${tag}.`);

		const filePaths = filesWithTag.map((f) => f.path);
		const targetFilePath = await GenericSuggester.Suggest(
			app,
			filePaths,
			filePaths
		);

		invariant(
			!!targetFilePath && targetFilePath.length > 0,
			`No file selected for capture.`
		);

		return await this.formatFilePath(targetFilePath);
	}

	private async onFileExists(
		filePath: string,
		content: string
	): Promise<{
		file: TFile;
		newFileContent: string;
		captureContent: string;
	}> {
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

		return { file, newFileContent, captureContent: formatted };
	}

	private async onCreateFileIfItDoesntExist(
		filePath: string,
		captureContent: string
	): Promise<{
		file: TFile;
		newFileContent: string;
		captureContent: string;
	}> {
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
				captureContent,
				this.choice,
				updatedFileContent,
				file
			);

		return { file, newFileContent, captureContent };
	}

	private async formatFilePath(captureTo: string) {
		const formattedCaptureTo: string = await this.formatter.formatFileName(
			captureTo,
			this.choice.name
		);

		return this.normalizeMarkdownFilePath("", formattedCaptureTo);
	}
}
