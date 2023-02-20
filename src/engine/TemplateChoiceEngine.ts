import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import {
	appendToCurrentLine,
	getAllFolderPathsInVault,
	openFile,
} from "../utility";
import {
	fileExistsAppendToBottom,
	fileExistsAppendToTop,
	fileExistsDoNothing,
	fileExistsChoices,
	fileExistsOverwriteFile,
	VALUE_SYNTAX,
} from "../constants";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import { TemplateEngine } from "./TemplateEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";

export class TemplateChoiceEngine extends TemplateEngine {
	public choice: ITemplateChoice;

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: ITemplateChoice,
		choiceExecutor: IChoiceExecutor
	) {
		super(app, plugin, choiceExecutor);
		this.choice = choice;
	}

	public async run(): Promise<void> {
		let folderPath: string = "";

		if (this.choice.folder.enabled) {
			folderPath = await this.getFolderPath();
		}

		let filePath;

		if (this.choice.fileNameFormat.enabled) {
			filePath = await this.getFormattedFilePath(
				folderPath,
				this.choice.fileNameFormat.format,
				this.choice.name
			);
		} else {
			filePath = await this.getFormattedFilePath(
				folderPath,
				VALUE_SYNTAX,
				this.choice.name
			);
		}

		if (this.choice.incrementFileName)
			filePath = await this.incrementFileName(filePath);

		let createdFile: TFile | null;
		if (await this.app.vault.adapter.exists(filePath)) {
			const file = this.app.vault.getAbstractFileByPath(filePath);
			if (!(file instanceof TFile) || file.extension !== "md") {
				log.logError(
					`'${filePath}' already exists and is not a valid markdown file.`
				);
				return;
			}

			await this.app.workspace.getLeaf("tab").openFile(file);

			let userChoice = this.choice.fileExistsMode;

			if(!this.choice.setFileExistsBehavior) {
				userChoice = await GenericSuggester.Suggest(
					this.app,
					fileExistsChoices,
					fileExistsChoices
				);
			}

			switch (userChoice) {
				case fileExistsAppendToTop:
					createdFile = await this.appendToFileWithTemplate(
						file,
						this.choice.templatePath,
						"top"
					);
					break;
				case fileExistsAppendToBottom:
					createdFile = await this.appendToFileWithTemplate(
						file,
						this.choice.templatePath,
						"bottom"
					);
					break;
				case fileExistsOverwriteFile:
					createdFile = await this.overwriteFileWithTemplate(
						file,
						this.choice.templatePath
					);
					break;
				case fileExistsDoNothing:
				default:
					log.logWarning("File not written to.");
					return;
			}
		} else {
			createdFile = await this.createFileWithTemplate(
				filePath,
				this.choice.templatePath
			);
			if (!createdFile) {
				log.logWarning(`Could not create file '${filePath}'.`);
				return;
			}
		}

		if (this.choice.appendLink) {
			appendToCurrentLine(
				this.app.fileManager.generateMarkdownLink(createdFile!, ""),
				this.app
			);
		}

		if (this.choice.openFile) {
			await openFile(this.app, createdFile!, {
				openInNewTab: this.choice.openFileInNewTab.enabled,
				direction: this.choice.openFileInNewTab.direction,
				focus: this.choice.openFileInNewTab.focus,
				mode: this.choice.openFileInMode,
			});
		}
	}

	private async formatFolderPaths(folders: string[]) {
		const folderPaths = await Promise.all(
			folders.map(async (folder) => {
				return await this.formatter.formatFolderPath(folder);
			})
		);

		return folderPaths;
	}

	private async getFolderPath() {
		let folders: string[] = await this.formatFolderPaths([
			...this.choice.folder.folders,
		]);

		if (
			this.choice.folder?.chooseFromSubfolders &&
			!(
				this.choice.folder?.chooseWhenCreatingNote ||
				this.choice.folder?.createInSameFolderAsActiveFile
			)
		) {
			const allFoldersInVault: string[] = getAllFolderPathsInVault(
				this.app
			);

			const subfolders = allFoldersInVault.filter((folder) => {
				return folders.some((f) => folder.startsWith(f));
			});

			return await this.getOrCreateFolder(subfolders);
		}

		if (this.choice.folder?.chooseWhenCreatingNote) {
			const allFoldersInVault: string[] = getAllFolderPathsInVault(
				this.app
			);
			return await this.getOrCreateFolder(allFoldersInVault);
		}

		if (this.choice.folder?.createInSameFolderAsActiveFile) {
			const activeFile = this.app.workspace.getActiveFile();

			if (!activeFile) {
				log.logWarning(
					"No active file. Cannot create file in same folder as active file. Creating in root folder."
				);
				return "";
			}

			return this.getOrCreateFolder([activeFile.parent.path]);
		}

		return await this.getOrCreateFolder(folders);
	}
}
