import { Notice, type App, type TFile } from "obsidian";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import invariant from "src/utils/invariant";
import merge from "three-way-merge";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import {
	QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
	VALUE_SYNTAX,
} from "../constants";
import { CaptureChoiceFormatter } from "../formatters/captureChoiceFormatter";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { normalizeAppendLinkOptions, type AppendLinkOptions } from "../types/linkPlacement";
import {
	appendToCurrentLine,
	getMarkdownFilesInFolder,
	getMarkdownFilesWithTag,
	insertFileLinkToActiveView,
	insertOnNewLineAbove,
	insertOnNewLineBelow,
	isTemplaterTriggerOnCreateEnabled,
	jumpToNextTemplaterCursorIfPossible,
	isFolder,
	openExistingFileTab,
	openFile,
	overwriteTemplaterOnce,
	templaterParseTemplate,
	waitForTemplaterTriggerOnCreateToComplete,
} from "../utilityObsidian";
import { isCancellationError, reportError } from "../utils/errorUtils";
import { normalizeFileOpening } from "../utils/fileOpeningDefaults";
import { QuickAddChoiceEngine } from "./QuickAddChoiceEngine";
import { MacroAbortError } from "../errors/MacroAbortError";
import { SingleTemplateEngine } from "./SingleTemplateEngine";
import { getCaptureAction, type CaptureAction } from "./captureAction";
import { handleMacroAbort } from "../utils/macroAbortHandler";

const DEFAULT_NOTICE_DURATION = 4000;

export class CaptureChoiceEngine extends QuickAddChoiceEngine {
	choice: ICaptureChoice;
	private formatter: CaptureChoiceFormatter;
	private readonly plugin: QuickAdd;
	private templatePropertyVars?: Map<string, unknown>;
	private capturePropertyVars: Map<string, unknown> = new Map();

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: ICaptureChoice,
		private choiceExecutor: IChoiceExecutor,
	) {
		super(app);
		this.choice = choice;
		this.plugin = plugin;
		this.formatter = new CaptureChoiceFormatter(app, plugin, choiceExecutor);
	}

	private showSuccessNotice(
		file: TFile,
		{ wasNewFile, action }: { wasNewFile: boolean; action: CaptureAction },
	) {
		const fileName = `'${file.basename}'`;

		if (wasNewFile) {
			new Notice(
				`Created and captured to ${fileName}`,
				DEFAULT_NOTICE_DURATION,
			);
			return;
		}

		let msg = "";
		switch (action) {
			case "currentLine":
				msg = `Captured to current line in ${fileName}`;
				break;
			case "prepend":
			case "activeFileTop":
				msg = `Captured to top of ${fileName}`;
				break;
			case "append":
				msg = `Captured to ${fileName}`;
				break;
			case "insertAfter": {
				const heading = this.choice.insertAfter.after;
				msg = heading
					? `Captured to ${fileName} under '${heading}'`
					: `Captured to ${fileName}`;
				break;
			}
		}

		new Notice(msg, DEFAULT_NOTICE_DURATION);
	}

	async run(): Promise<void> {
		try {
			// Reset any pending structured values before starting a new capture run
			this.capturePropertyVars.clear();
			const linkOptions = normalizeAppendLinkOptions(this.choice.appendLink);
			this.formatter.setLinkToCurrentFileBehavior(
				linkOptions.enabled && !linkOptions.requireActiveFile
					? "optional"
					: "required",
			);
			const selectionOverride = this.choice.useSelectionAsCaptureValue;
			const globalSelectionAsValue =
				this.plugin.settings.useSelectionAsCaptureValue ?? true;
			const useSelectionAsCaptureValue =
				typeof selectionOverride === "boolean"
					? selectionOverride
					: globalSelectionAsValue;
			this.formatter.setUseSelectionAsCaptureValue(useSelectionAsCaptureValue);

			const filePath = await this.getFormattedPathToCaptureTo(
				this.choice.captureToActiveFile,
			);
			const content = this.getCaptureContent();

			let getFileAndAddContentFn: typeof this.onFileExists;
			const fileAlreadyExists = await this.fileExists(filePath);

			if (fileAlreadyExists) {
				getFileAndAddContentFn = this.onFileExists.bind(
					this,
				) as typeof this.onFileExists;
				} else if (this.choice?.createFileIfItDoesntExist?.enabled) {
					getFileAndAddContentFn = ((path, capture, _options) =>
						this.onCreateFileIfItDoesntExist(path, capture, linkOptions)
					) as typeof this.onCreateFileIfItDoesntExist;
			} else {
				log.logWarning(
					`The file ${filePath} does not exist and "Create file if it doesn't exist" is disabled.`,
				);
				return;
			}

			const { file, newFileContent, captureContent } =
				await getFileAndAddContentFn(filePath, content);

		const action = getCaptureAction(this.choice);
		const isEditorInsertionAction =
			action === "currentLine" ||
			action === "newLineAbove" ||
			action === "newLineBelow";

		// Handle capture to active file with special actions
		if (isEditorInsertionAction) {
				// Parse Templater syntax in the capture content.
				// If Templater isn't installed, it just returns the capture content.
				const content = await templaterParseTemplate(
					this.app,
					captureContent,
					file,
				);

				switch (action) {
					case "currentLine":
						appendToCurrentLine(content, this.app);
						break;
					case "newLineAbove":
						insertOnNewLineAbove(content, this.app);
						break;
					case "newLineBelow":
						insertOnNewLineBelow(content, this.app);
						break;
				}
			} else {
				await this.app.vault.modify(file, newFileContent);
				if (this.choice.templater?.afterCapture === "wholeFile") {
					await overwriteTemplaterOnce(this.app, file);
				}
				await this.applyCapturePropertyVars(file);
			}

			// Show success notification
			if (this.plugin.settings.showCaptureNotification) {
				this.showSuccessNotice(file, {
					wasNewFile: !fileAlreadyExists,
					action,
				});
			}

				if (linkOptions.enabled) {
				insertFileLinkToActiveView(this.app, file, linkOptions);
			}

			if (this.choice.openFile && file) {
				const fileOpening = normalizeFileOpening(this.choice.fileOpening);
				const focus = fileOpening.focus ?? true;
				const openExistingTab = openExistingFileTab(this.app, file, focus);

				if (!openExistingTab) {
					await openFile(this.app, file, fileOpening);
				}

				await jumpToNextTemplaterCursorIfPossible(this.app, file);
			}
		} catch (err) {
			if (
				handleMacroAbort(err, {
					logPrefix: "Capture execution aborted",
					noticePrefix: "Capture execution aborted",
					defaultReason: "Capture aborted",
				})
			) {
				this.choiceExecutor.signalAbort?.(err as MacroAbortError);
				return;
			}
			reportError(err, `Error running capture choice "${this.choice.name}"`);
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
		shouldCaptureToActiveFile: boolean,
	): Promise<string> {
		// One-page preflight: if a specific target file was already chosen, use it
		const preselected = this.choiceExecutor?.variables?.get(
			QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
		) as string | undefined;
		if (
			!shouldCaptureToActiveFile &&
			preselected &&
			typeof preselected === "string" &&
			preselected.length > 0
		) {
			return preselected;
		}

		if (shouldCaptureToActiveFile) {
			const activeFile = this.app.workspace.getActiveFile();
			invariant(activeFile, "Cannot capture to active file - no active file.");

			return activeFile.path;
		}

		const captureTo = this.choice.captureTo;
		const formattedCaptureTo = await this.formatFilePath(captureTo);

		// Removing the trailing slash from the capture to path because otherwise isFolder will fail
		// to get the folder.
		const folderPath = formattedCaptureTo.replace(/^\/$|\/\.md$|^\.md$/, "");
		// Empty string means we suggest to capture anywhere in the vault.
		const captureAnywhereInVault = folderPath === "";
		const shouldCaptureToFolder =
			captureAnywhereInVault || isFolder(this.app, folderPath);
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
		captureAnywhereInVault: boolean,
	): Promise<string> {
		const folderPathSlash =
			folderPath.endsWith("/") || captureAnywhereInVault
				? folderPath
				: `${folderPath}/`;
		const filesInFolder = getMarkdownFilesInFolder(this.app, folderPathSlash);

		invariant(filesInFolder.length > 0, `Folder ${folderPathSlash} is empty.`);

		const filePaths = filesInFolder.map((f) => f.path);
		let targetFilePath: string;
		try {
			targetFilePath = await InputSuggester.Suggest(
				this.app,
				filePaths.map((item) => item.replace(folderPathSlash, "")),
				filePaths,
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new MacroAbortError("Input cancelled by user");
			}
			throw error;
		}

		invariant(
			!!targetFilePath && targetFilePath.length > 0,
			"No file selected for capture.",
		);

		// Ensure user has selected a file in target folder. InputSuggester allows user to write
		// their own file path, so we need to make sure it's in the target folder.
		const filePath = targetFilePath.startsWith(`${folderPathSlash}`)
			? targetFilePath
			: `${folderPathSlash}/${targetFilePath}`;

		return await this.formatFilePath(filePath);
	}

	private async selectFileWithTag(tag: string): Promise<string> {
		const tagWithHash = tag.startsWith("#") ? tag : `#${tag}`;
		const filesWithTag = getMarkdownFilesWithTag(this.app, tagWithHash);

		invariant(filesWithTag.length > 0, `No files with tag ${tag}.`);

		const filePaths = filesWithTag.map((f) => f.path);
		let targetFilePath: string;
		try {
			targetFilePath = await InputSuggester.Suggest(
				this.app,
				filePaths,
				filePaths,
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new MacroAbortError("Input cancelled by user");
			}
			throw error;
		}

		invariant(
			!!targetFilePath && targetFilePath.length > 0,
			"No file selected for capture.",
		);

		return await this.formatFilePath(targetFilePath);
	}

	private async onFileExists(
		filePath: string,
		content: string,
	): Promise<{
		file: TFile;
		newFileContent: string;
		captureContent: string;
	}> {
		const file: TFile = this.getFileByPath(filePath);
		if (!file) throw new Error("File not found");

		// Set the title to the existing file's basename
		this.formatter.setTitle(file.basename);

		// Set the destination file so formatters can generate proper relative links
		this.formatter.setDestinationFile(file);

		// First format pass...
		const formatted = await this.formatter.formatContentOnly(content);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());

		const fileContent: string = await this.app.vault.read(file);
		// Second format pass, with the file content... User input (long running) should have been captured during first pass
		// So this pass is to insert the formatted capture value into the file content, depending on the user's settings
		const formattedFileContent: string =
			await this.formatter.formatContentWithFile(
				formatted,
				this.choice,
				fileContent,
				file,
			);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());

		const secondReadFileContent: string = await this.app.vault.read(file);

		let newFileContent = formattedFileContent;
		if (secondReadFileContent !== fileContent) {
			const res = merge(
				secondReadFileContent,
				fileContent,
				formattedFileContent,
			);
			invariant(
				!res.isSuccess,
				() =>
					`The file ${filePath} has been modified since the last read.\nQuickAdd could not merge the versions two without conflicts, and will not modify the file.\nThis is in order to prevent data loss.`,
			);

			newFileContent = res.joinedResults() as string;
		}

		return { file, newFileContent, captureContent: formatted };
	}

	private async onCreateFileIfItDoesntExist(
		filePath: string,
		captureContent: string,
		linkOptions?: AppendLinkOptions,
	): Promise<{
		file: TFile;
		newFileContent: string;
		captureContent: string;
	}> {
		// Extract filename without extension from the full path
		const fileBasename = filePath.split("/").pop()?.replace(/\.md$/, "") || "";
		this.formatter.setTitle(fileBasename);

		// Set the destination path so formatters can generate proper relative links
		// even before the file is created
		this.formatter.setDestinationSourcePath(filePath);

		// First formatting pass: resolve QuickAdd placeholders and prompt for user input (e.g. {{value}})
		// This mirrors the logic used when the target file already exists and prevents the timing issue
		// where templater would run before the {{value}} placeholder is substituted (Issue #809).
		const formattedCaptureContent: string =
			await this.formatter.formatContentOnly(captureContent);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());

		let fileContent = "";
		if (this.choice.createFileIfItDoesntExist.createWithTemplate) {
			const singleTemplateEngine: SingleTemplateEngine =
				new SingleTemplateEngine(
					this.app,
					this.plugin,
					this.choice.createFileIfItDoesntExist.template,
					this.choiceExecutor,
				);

			if (linkOptions?.enabled && !linkOptions.requireActiveFile) {
				singleTemplateEngine.setLinkToCurrentFileBehavior("optional");
			}

			fileContent = await singleTemplateEngine.run();

			// Get template variables from the template engine's formatter
			const templateVars = singleTemplateEngine.getAndClearTemplatePropertyVars();

			log.logMessage(`CaptureChoiceEngine: Collected ${templateVars.size} template property variables`);
			if (templateVars.size > 0) {
				log.logMessage(`Variables: ${Array.from(templateVars.keys()).join(', ')}`);
			}

			// Store for later use
			this.templatePropertyVars = templateVars;
		}

		// Determine Templater execution strategy:
		// If trigger-on-create is enabled, let Templater's auto-trigger handle it.
		// If disabled, suppress auto-trigger and run explicitly via overwriteTemplaterOnce.
		// This mutual exclusion prevents the double-execution race in #1084.
		const triggerOnCreate = isTemplaterTriggerOnCreateEnabled(this.app);
		const createWithTemplate = this.choice.createFileIfItDoesntExist.createWithTemplate;

		// If relying on auto-trigger, do NOT suppress it
		const suppressTemplaterOnCreate = createWithTemplate && !triggerOnCreate;

		// Create the new file with the (optional) template content
		const file: TFile = await this.createFileWithInput(filePath, fileContent, {
			suppressTemplaterOnCreate,
		});

		// Post-process front matter for template property types if we used a template
		if (createWithTemplate &&
			this.templatePropertyVars &&
			this.shouldPostProcessFrontMatter(file, this.templatePropertyVars)) {
			await this.postProcessFrontMatter(file, this.templatePropertyVars);
		}

		// Run Templater exactly once: either via auto-trigger or explicit call
		if (createWithTemplate && fileContent) {
			if (triggerOnCreate) {
				// Let Templater's trigger-on-create handle it, just wait for completion
				await waitForTemplaterTriggerOnCreateToComplete(this.app, file);
			} else {
				// Trigger-on-create is disabled, run explicitly
				await overwriteTemplaterOnce(this.app, file);
			}
		} else if (triggerOnCreate) {
			// No template but trigger-on-create is enabled, wait for it
			await waitForTemplaterTriggerOnCreateToComplete(this.app, file);
		}

		// Read the file fresh from disk to avoid any potential cached content
		// after the initial Templater run on newly created files.
		const updatedFileContent: string = await this.app.vault.read(file);
		// Second formatting pass: embed the already-resolved capture content into the newly created file
		const newFileContent: string = await this.formatter.formatContentWithFile(
			formattedCaptureContent,
			this.choice,
			updatedFileContent,
			file,
		);
		this.mergeCapturePropertyVars(this.formatter.getAndClearTemplatePropertyVars());

		return { file, newFileContent, captureContent: formattedCaptureContent };
	}

	private async formatFilePath(captureTo: string) {
		const formattedCaptureTo: string = await this.formatter.formatFileName(
			captureTo,
			this.choice.name,
		);

		return this.normalizeMarkdownFilePath("", formattedCaptureTo);
	}

	private mergeCapturePropertyVars(vars: Map<string, unknown>): void {
		if (!vars || vars.size === 0) {
			return;
		}

		for (const [key, value] of vars) {
			this.capturePropertyVars.set(key, value);
		}

		log.logMessage(
			`CaptureChoiceEngine: Accumulated ${this.capturePropertyVars.size} structured capture variables`
		);
	}

	private async applyCapturePropertyVars(file: TFile): Promise<void> {
		if (this.capturePropertyVars.size === 0) {
			return;
		}

		if (!this.shouldPostProcessFrontMatter(file, this.capturePropertyVars)) {
			this.capturePropertyVars.clear();
			return;
		}

		log.logMessage(
			`CaptureChoiceEngine: Post-processing front matter with ${this.capturePropertyVars.size} capture variables`
		);
		await this.postProcessFrontMatter(file, this.capturePropertyVars);
		this.capturePropertyVars.clear();
	}
}
