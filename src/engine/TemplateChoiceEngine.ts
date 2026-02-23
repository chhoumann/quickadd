import type { App } from "obsidian";
import { TFile } from "obsidian";
import { TFolder } from "obsidian";
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
	jumpToNextTemplaterCursorIfPossible,
	openExistingFileTab,
	openFile,
} from "../utilityObsidian";
import { isCancellationError, reportError } from "../utils/errorUtils";
import { normalizeFileOpening } from "../utils/fileOpeningDefaults";
import { TemplateEngine } from "./TemplateEngine";
import { MacroAbortError } from "../errors/MacroAbortError";
import { handleMacroAbort } from "../utils/macroAbortHandler";

export class TemplateChoiceEngine extends TemplateEngine {
	public choice: ITemplateChoice;
	private readonly choiceExecutor: IChoiceExecutor;

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: ITemplateChoice,
		choiceExecutor: IChoiceExecutor,
	) {
		super(app, plugin, choiceExecutor);
		this.choiceExecutor = choiceExecutor;
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
					this.app.workspace.getActiveFile()?.path ?? "",
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
			const { fileName, strippedPrefix } = this.stripDuplicateFolderPrefix(
				formattedName,
				folderPath,
			);
			const treatAsVaultRelativePath =
				this.shouldTreatFormattedNameAsVaultRelativePath(
					formattedName,
					strippedPrefix,
				);

			let filePath = this.normalizeTemplateFilePath(
				treatAsVaultRelativePath ? "" : folderPath,
				fileName,
				this.choice.templatePath,
			);

			if (this.choice.fileExistsMode === fileExistsIncrement)
				filePath = await this.incrementFileName(filePath);

			let createdFile: TFile | null;
			let shouldAutoOpen = false;
			if (await this.app.vault.adapter.exists(filePath)) {
				const file = this.findExistingFile(filePath);
				if (
					!(file instanceof TFile) ||
					(file.extension !== "md" && file.extension !== "canvas")
				) {
					log.logError(
						`'${filePath}' already exists but could not be resolved as a markdown or canvas file.`,
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
				const fileOpening = normalizeFileOpening(this.choice.fileOpening);
				const focus = fileOpening.focus ?? true;
				const openExistingTab = openExistingFileTab(
					this.app,
					createdFile,
					focus,
				);

				if (!openExistingTab) {
					await openFile(this.app, createdFile, fileOpening);
				}

				await jumpToNextTemplaterCursorIfPossible(this.app, createdFile);
			}
		} catch (err) {
			if (
				handleMacroAbort(err, {
					logPrefix: "Template execution aborted",
					noticePrefix: "Template execution aborted",
					defaultReason: "Template execution aborted",
				})
			) {
				this.choiceExecutor.signalAbort?.(err as MacroAbortError);
				return;
			}
			reportError(err, `Error running template choice "${this.choice.name}"`);
		}
	}

	/**
	 * Resolve an existing file by path with a case-insensitive fallback.
	 *
	 * Obsidian's in-memory file index is case-sensitive, but on
	 * case-insensitive filesystems adapter.exists can still return true.
	 * If a direct lookup fails, scan the vault for a single case-insensitive
	 * match. Multiple matches are treated as ambiguous and return null.
	 */
	private findExistingFile(filePath: string): TFile | null {
		const direct = this.app.vault.getAbstractFileByPath(filePath);
		if (direct instanceof TFile) return direct;
		if (direct) return null;

		// On case-insensitive filesystems, adapter.exists can return true even when
		// Obsidian's case-sensitive path index can't resolve the file.
		const lowerPath = filePath.toLowerCase();
		const matches = this.app.vault
			.getFiles()
			.filter((file) => file.path.toLowerCase() === lowerPath);

		if (matches.length === 1) return matches[0];
		if (matches.length > 1) {
			const matchList = matches.map((match) => match.path).join(", ");
			log.logError(
				`Multiple files match '${filePath}' when ignoring case: ${matchList}`,
			);
		}

		return null;
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
		const currentFolder = this.getCurrentFolderSuggestion();
		const topItems = currentFolder ? [currentFolder] : [];

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

			return await this.getOrCreateFolder(subfolders, {
				allowCreate: true,
				allowedRoots: folders,
				topItems,
			});
		}

		if (this.choice.folder?.chooseWhenCreatingNote) {
			const allFoldersInVault: string[] = getAllFolderPathsInVault(this.app);
			return await this.getOrCreateFolder(allFoldersInVault, {
				allowCreate: true,
				topItems,
			});
		}

		if (this.choice.folder?.createInSameFolderAsActiveFile) {
			const activeFile = this.app.workspace.getActiveFile();

			if (!activeFile || !activeFile.parent) {
				log.logWarning(
					"No active file or active file has no parent. Cannot create file in same folder as active file. Creating in root folder.",
				);
				return "";
			}

			return await this.getOrCreateFolder([activeFile.parent.path], {
				allowCreate: true,
				topItems,
			});
		}

		return await this.getOrCreateFolder(folders, {
			allowCreate: true,
			allowedRoots: folders,
			topItems,
		});
	}

	private stripDuplicateFolderPrefix(
		fileName: string,
		folderPath: string,
	): { fileName: string; strippedPrefix: boolean } {
		const normalizedFolder = this.stripLeadingSlash(folderPath);
		const normalizedFileName = this.stripLeadingSlash(fileName);

		if (!normalizedFolder) {
			return { fileName: normalizedFileName, strippedPrefix: false };
		}
		if (!normalizedFileName.startsWith(`${normalizedFolder}/`)) {
			return { fileName: normalizedFileName, strippedPrefix: false };
		}

		return {
			fileName: normalizedFileName.slice(normalizedFolder.length + 1),
			strippedPrefix: true,
		};
	}

	private shouldTreatFormattedNameAsVaultRelativePath(
		formattedName: string,
		strippedPrefix: boolean,
	): boolean {
		if (this.choice.folder.enabled) return false;
		if (strippedPrefix) return false;

		const normalizedFileName = formattedName.trim();
		if (!normalizedFileName.includes("/")) return false;
		if (normalizedFileName.startsWith("./")) return false;

		if (normalizedFileName.startsWith("/")) return true;

		const [firstSegment] = this.stripLeadingSlash(normalizedFileName).split("/");
		if (!firstSegment) return false;

		const rootEntry = this.app.vault.getAbstractFileByPath(firstSegment);
		return rootEntry instanceof TFolder;
	}

	private getCurrentFolderSuggestion():
		| { path: string; label: string }
		| null {
		const activeFile = this.app.workspace.getActiveFile();
		const parent = activeFile?.parent;
		if (!activeFile || !parent) return null;
		const path = parent.path ?? "";
		return {
			path,
			label: "<current folder>",
		};
	}
}
