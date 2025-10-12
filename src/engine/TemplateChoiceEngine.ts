import type { App } from "obsidian";
import { TFile } from "obsidian";
import invariant from "src/utils/invariant";
import {
	fileExistsAppendToBottom,
	fileExistsAppendToTop,
	fileExistsChoices,
	fileExistsDoNothing,
	fileExistsIncrement,
	fileExistsOverwriteFile,
	VALUE_SYNTAX,
} from "../constants";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { normalizeAppendLinkOptions } from "../types/linkPlacement";
import {
	getAllFolderPathsInVault,
	insertFileLinkToActiveView,
	openExistingFileTab,
	openFile,
} from "../utilityObsidian";
import { reportError } from "../utils/errorUtils";
import { TemplateEngine } from "./TemplateEngine";
import { MacroAbortError } from "../errors/MacroAbortError";
import { isCancellationError } from "../utils/errorUtils";

export class TemplateChoiceEngine extends TemplateEngine {
	public choice: ITemplateChoice;

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: ITemplateChoice,
		choiceExecutor: IChoiceExecutor,
	) {
		super(app, plugin, choiceExecutor);
		this.choice = choice;
	}

	public async run(): Promise<void> {
		try {
			invariant(this.choice.templatePath, () => {
				return `Invalid template path for ${this.choice.name}. ${this.choice.templatePath.length === 0
						? "Template path is empty."
						: `Template path is not valid: ${this.choice.templatePath}`
					}`;
			});

			const linkOptions = normalizeAppendLinkOptions(this.choice.appendLink);
			this.setLinkToCurrentFileBehavior(
				linkOptions.enabled && !linkOptions.requireActiveFile
					? "optional"
					: "required",
			);

			let folderPath = "";

			if (this.choice.folder.enabled) {
			folderPath = await this.getFolderPath();
			} else {
			// Respect Obsidian's "Default location for new notes" setting
			const parent = this.app.fileManager.getNewFileParent(
				this.app.workspace.getActiveFile()?.path ?? ""
			);
			folderPath = parent === this.app.vault.getRoot() ? "" : parent.path;
		}

			const format = this.choice.fileNameFormat.enabled
				? this.choice.fileNameFormat.format
				: VALUE_SYNTAX;
			const formattedName = await this.formatter.formatFileName(
				format,
				this.choice.name,
			);
			

			let filePath = this.normalizeTemplateFilePath(
				folderPath,
				formattedName,
				this.choice.templatePath,
			);

			if (this.choice.fileExistsMode === fileExistsIncrement)
				filePath = await this.incrementFileName(filePath);

			let createdFile: TFile | null;
			let shouldAutoOpen = false;
			if (await this.app.vault.adapter.exists(filePath)) {
				const file = this.app.vault.getAbstractFileByPath(filePath);
				if (
					!(file instanceof TFile) ||
					(file.extension !== "md" && file.extension !== "canvas")
				) {
					log.logError(
						`'${filePath}' already exists and is not a valid markdown or canvas file.`,
					);
					return;
				}

				let userChoice: (typeof fileExistsChoices)[number] =
					this.choice.fileExistsMode;

				if (!this.choice.setFileExistsBehavior) {
					try {
						userChoice = await GenericSuggester.Suggest(
							this.app,
							[...fileExistsChoices],
							[...fileExistsChoices],
						);
					} catch (error) {
						if (isCancellationError(error)) {
							throw new MacroAbortError("Input cancelled by user");
						}
						throw error;
					}
				}

				switch (userChoice) {
					case fileExistsAppendToTop:
						createdFile = await this.appendToFileWithTemplate(
							file,
							this.choice.templatePath,
							"top",
						);
						break;
					case fileExistsAppendToBottom:
						createdFile = await this.appendToFileWithTemplate(
							file,
							this.choice.templatePath,
							"bottom",
						);
						break;
					case fileExistsOverwriteFile:
						createdFile = await this.overwriteFileWithTemplate(
							file,
							this.choice.templatePath,
						);
						break;
					case fileExistsDoNothing:
						createdFile = file;
						shouldAutoOpen = true; // Auto-open existing file when user chooses "Nothing"
						log.logMessage(`Opening existing file: ${file.path}`);
						break;
					case fileExistsIncrement: {
						const incrementFileName = await this.incrementFileName(filePath);
						createdFile = await this.createFileWithTemplate(
							incrementFileName,
							this.choice.templatePath,
						);
						break;
					}
					default:
						log.logWarning("File not written to.");
						return;
				}
			} else {
				createdFile = await this.createFileWithTemplate(
					filePath,
					this.choice.templatePath,
				);
				if (!createdFile) {
					log.logWarning(`Could not create file '${filePath}'.`);
					return;
				}
			}

			if (linkOptions.enabled && createdFile) {
			insertFileLinkToActiveView(this.app, createdFile, linkOptions);
			}

			if ((this.choice.openFile || shouldAutoOpen) && createdFile) {
				const openExistingTab = openExistingFileTab(this.app, createdFile);

				if (!openExistingTab) {
					await openFile(this.app, createdFile, this.choice.fileOpening);
				}
			}
		} catch (err) {
			reportError(err, `Error running template choice "${this.choice.name}"`);
		}
	}

	private async formatFolderPaths(folders: string[]) {
		const folderPaths = await Promise.all(
			folders.map(async (folder) => {
				return await this.formatter.formatFolderPath(folder);
			}),
		);

		return folderPaths;
	}

	private async getFolderPath() {
		const folders: string[] = await this.formatFolderPaths([
			...this.choice.folder.folders,
		]);

		if (
			this.choice.folder?.chooseFromSubfolders &&
			!(
				this.choice.folder?.chooseWhenCreatingNote ||
				this.choice.folder?.createInSameFolderAsActiveFile
			)
		) {
			const allFoldersInVault: string[] = getAllFolderPathsInVault(this.app);

			const subfolders = allFoldersInVault.filter((folder) => {
				return folders.some((f) => folder.startsWith(f));
			});

			return await this.getOrCreateFolder(subfolders);
		}

		if (this.choice.folder?.chooseWhenCreatingNote) {
			const allFoldersInVault: string[] = getAllFolderPathsInVault(this.app);
			return await this.getOrCreateFolder(allFoldersInVault);
		}

		if (this.choice.folder?.createInSameFolderAsActiveFile) {
			const activeFile = this.app.workspace.getActiveFile();

			if (!activeFile || !activeFile.parent) {
				log.logWarning(
					"No active file or active file has no parent. Cannot create file in same folder as active file. Creating in root folder.",
				);
				return "";
			}

			return this.getOrCreateFolder([activeFile.parent.path]);
		}

		return await this.getOrCreateFolder(folders);
	}
}
