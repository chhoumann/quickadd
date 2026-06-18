import type { App, WorkspaceLeaf } from "obsidian";
import { TFile } from "obsidian";
import invariant from "src/utils/invariant";
import { VALUE_SYNTAX } from "../constants";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import {
	getFileExistsMode,
	getPromptModes,
	resolveCreateNewCollisionFilePath,
	type FileExistsModeId,
} from "../template/fileExistsPolicy";
import {
	promptForTemplateNoteDiscovery,
	shouldRunTemplateNoteDiscovery,
} from "./templateNoteDiscovery";
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
import {
	filterFolderPathsWithinRoots,
	sortFolderPathsByTree,
} from "../utils/folder-sorting";
import { normalizeFileOpening } from "../utils/fileOpeningDefaults";
import { normalizeGeneratedFilePath } from "../utils/generatedFilePath";
import { copyFileLinkToClipboard } from "../utils/fileLinks";
import { InputPromptDraftStore } from "../utils/InputPromptDraftStore";
import { TemplateEngine } from "./TemplateEngine";
import { UserCancelError } from "../errors/UserCancelError";
import { handleMacroAbort } from "../utils/macroAbortHandler";
import { parentFolderPath } from "../utils/pathUtils";

export class TemplateChoiceEngine extends TemplateEngine {
	public choice: ITemplateChoice;
	private readonly choiceExecutor: IChoiceExecutor;

	constructor(
		app: App,
		plugin: QuickAdd,
		choice: ITemplateChoice,
		choiceExecutor: IChoiceExecutor,
		private readonly originLeaf: WorkspaceLeaf | null = null,
	) {
		super(app, plugin, choiceExecutor);
		this.choiceExecutor = choiceExecutor;
		this.choice = choice;
	}

	public async run(): Promise<void> {
		let restoreDiscoveryValue: (() => void) | null = null;
		let discoveryVaultRelativePath: string | null = null;

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

			const format = this.choice.fileNameFormat.enabled
				? this.choice.fileNameFormat.format
				: VALUE_SYNTAX;

			if (
				shouldRunTemplateNoteDiscovery(
					this.choice,
					format,
					this.choiceExecutor.variables.get("value"),
				)
			) {
				const discovery = await promptForTemplateNoteDiscovery(
					this.app,
					this.choice,
				);
				if (discovery.kind === "openExisting") {
					await this.openDiscoveredExistingNote(discovery.file);
					this.choiceExecutor.recordExecutionResult?.({
						status: "success",
						file: discovery.file,
					});
					return;
				}

				restoreDiscoveryValue = this.setTemporaryValueVariable(discovery.title);
				discoveryVaultRelativePath = discovery.vaultRelativePath ?? null;
			}

			// Resolve format tokens in the template path ONCE, after discovery has
			// either selected "create" or been skipped. Existing-note discovery exits
			// before any template-path prompt, folder creation, or template side effect.
			const templatePath = await this.resolveTemplateSourcePath(
				this.choice.templatePath,
			);

			let folderPath = "";

			if (discoveryVaultRelativePath) {
				folderPath = parentFolderPath(discoveryVaultRelativePath);
			} else if (this.choice.folder.enabled) {
				folderPath = await this.getFolderPath();
			} else {
				// Respect Obsidian's "Default location for new notes" setting
				const parent = this.app.fileManager.getNewFileParent(
					this.app.workspace.getActiveFile()?.path ?? "",
				);
				folderPath = parent === this.app.vault.getRoot() ? "" : parent.path;
			}

			// Make the resolved folder available to {{FOLDER}} in the file name.
			this.formatter.setTargetFolderPath(folderPath);

			const formattedName = discoveryVaultRelativePath
				? discoveryVaultRelativePath
				: await this.formatter.formatFileName(format, this.choice.name);
			const routedName = normalizeGeneratedFilePath(formattedName, "File name");
			const { fileName, strippedPrefix } = discoveryVaultRelativePath
				? { fileName: routedName, strippedPrefix: false }
				: this.stripDuplicateFolderPrefix(
					routedName,
					folderPath,
				);
			const treatAsVaultRelativePath =
				this.shouldTreatFormattedNameAsVaultRelativePath(
					routedName,
					strippedPrefix,
					this.choice.folder.enabled,
				);

			const targetFilePath = this.normalizeTemplateFilePath(
				discoveryVaultRelativePath || treatAsVaultRelativePath ? "" : folderPath,
				fileName,
				templatePath,
			);

			let createdFile: TFile | null;
			let shouldAutoOpen = false;
			if (await this.app.vault.adapter.exists(targetFilePath)) {
				const modeId = await this.getSelectedFileExistsMode();
				const mode = getFileExistsMode(modeId);
				const existingFile = mode.requiresExistingFile
					? this.findExistingFile(targetFilePath)
					: null;

				if (
					mode.requiresExistingFile &&
					(!(existingFile instanceof TFile) ||
						(existingFile.extension !== "md" &&
							existingFile.extension !== "canvas" &&
							existingFile.extension !== "base"))
				) {
					InputPromptDraftStore.getInstance().markExecutionScopeFailed();
					log.logError(
						`'${targetFilePath}' already exists but could not be resolved as a markdown, canvas, or base file.`,
					);
					return;
				}

				({ createdFile, shouldAutoOpen } = await this.applyFileExistsMode(
					modeId,
					targetFilePath,
					existingFile,
					templatePath,
				));
				if (!createdFile) {
					InputPromptDraftStore.getInstance().markExecutionScopeFailed();
					log.logWarning(`Could not resolve file exists behavior for '${targetFilePath}'.`);
					return;
				}
			} else {
				createdFile = await this.createFileWithTemplate(
					targetFilePath,
					templatePath,
				);
				if (!createdFile) {
					InputPromptDraftStore.getInstance().markExecutionScopeFailed();
					log.logWarning(`Could not create file '${targetFilePath}'.`);
					return;
				}
			}

			// File is created/resolved (the commit point). Record success BEFORE the
			// cosmetic steps below (link / open / templater jump) so a later cosmetic
			// failure cannot downgrade the outcome for an x-callback caller.
			this.choiceExecutor.recordExecutionResult?.({
				status: "success",
				file: createdFile,
			});

			if (linkOptions.enabled && createdFile) {
				insertFileLinkToActiveView(this.app, createdFile, linkOptions);
			}

			if (this.choice.copyLinkToClipboard && createdFile) {
				try {
					await copyFileLinkToClipboard(createdFile);
				} catch (error) {
					log.logWarning(
						`Could not copy link to clipboard for '${createdFile.path}': ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				}
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
					await openFile(this.app, createdFile, {
						...fileOpening,
						originLeaf: this.originLeaf,
					});
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
				this.choiceExecutor.signalAbort?.(err);
				return;
			}
			InputPromptDraftStore.getInstance().markExecutionScopeFailed();
			reportError(err, `Error running template choice "${this.choice.name}"`);
		} finally {
			restoreDiscoveryValue?.();
		}
	}

	private setTemporaryValueVariable(value: string): () => void {
		const variables = this.choiceExecutor.variables;
		const hadPreviousValue = variables.has("value");
		const previousValue = variables.get("value");

		variables.set("value", value);

		return () => {
			if (hadPreviousValue) {
				variables.set("value", previousValue);
				return;
			}
			variables.delete("value");
		};
	}

	private async getSelectedFileExistsMode(): Promise<FileExistsModeId> {
		this.choice.fileExistsBehavior ??= { kind: "prompt" };

		if (this.choice.fileExistsBehavior.kind === "apply") {
			return this.choice.fileExistsBehavior.mode;
		}

		const promptModes = getPromptModes();

		try {
			return await GenericSuggester.Suggest(
				this.app,
				promptModes.map((mode) => mode.label),
				promptModes.map((mode) => mode.id),
				"If the target file already exists",
			);
		} catch (error) {
			if (isCancellationError(error)) {
				throw new UserCancelError("Input cancelled by user");
			}
			throw error;
		}
	}

	private async applyFileExistsMode(
		modeId: FileExistsModeId,
		targetFilePath: string,
		existingFile: TFile | null,
		templatePath: string,
	): Promise<{ createdFile: TFile | null; shouldAutoOpen: boolean }> {
		const mode = getFileExistsMode(modeId);

		switch (mode.resolutionKind) {
			case "modifyExisting":
				return {
					createdFile: await this.applyExistingFileUpdate(
						mode.id,
						existingFile!,
						templatePath,
					),
					shouldAutoOpen: false,
				};
			case "createNew": {
				const nextFilePath = await resolveCreateNewCollisionFilePath(
					targetFilePath,
					mode.id,
					async (path) => await this.app.vault.adapter.exists(path),
				);

				return {
					createdFile: await this.createFileWithTemplate(
						nextFilePath,
						templatePath,
					),
					shouldAutoOpen: false,
				};
			}
			case "reuseExisting":
				log.logMessage(`Opening existing file: ${existingFile!.path}`);
				return {
					createdFile: existingFile,
					shouldAutoOpen: true,
				};
		}
	}

	private async openDiscoveredExistingNote(file: TFile): Promise<void> {
		const fileOpening = normalizeFileOpening(this.choice.fileOpening);
		const openExistingTab = openExistingFileTab(this.app, file, true);

		if (!openExistingTab) {
			await openFile(this.app, file, {
				...fileOpening,
				focus: true,
				originLeaf: this.originLeaf,
			});
		}
	}

	private async applyExistingFileUpdate(
		modeId: "appendTop" | "appendBottom" | "overwrite",
		existingFile: TFile,
		templatePath: string,
	): Promise<TFile | null> {
		switch (modeId) {
			case "appendTop":
				return await this.appendToFileWithTemplate(
					existingFile,
					templatePath,
					"top",
				);
			case "appendBottom":
				return await this.appendToFileWithTemplate(
					existingFile,
					templatePath,
					"bottom",
				);
			case "overwrite":
				return await this.overwriteFileWithTemplate(
					existingFile,
					templatePath,
				);
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

	// The branch precedence below is mirrored by the choice builder's folder-mode
	// dropdown (gui/ChoiceBuilder/folderMode.ts → deriveFolderMode). If you change
	// the order or conditions here, update that helper (and its 16-combo test) so
	// the dropdown keeps showing the mode that actually runs.
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
			const allFoldersInVault: string[] = sortFolderPathsByTree(
				getAllFolderPathsInVault(this.app),
			);

			const subfolders = filterFolderPathsWithinRoots(
				allFoldersInVault,
				folders,
			);

			return await this.getOrCreateFolder(subfolders, {
				allowCreate: true,
				allowedRoots: folders,
				topItems,
			});
		}

		if (this.choice.folder?.chooseWhenCreatingNote) {
			const allFoldersInVault: string[] = sortFolderPathsByTree(
				getAllFolderPathsInVault(this.app),
			);
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
