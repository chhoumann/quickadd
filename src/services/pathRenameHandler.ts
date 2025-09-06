import type { App, TAbstractFile } from "obsidian";
import { Notice, TFile, TFolder } from "obsidian";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";
import { isFolder } from "../utilityObsidian";
import { FolderPathUpdater, type UpdateOptions } from "../utils/folderPathUpdater";
import { PathNormalizer } from "../utils/pathNormalizer";

/**
 * Handles file and folder rename events and automatically updates QuickAdd choice configurations.
 */
export class PathRenameHandler {
	private app: App;
	private plugin: QuickAdd;

	constructor(app: App, plugin: QuickAdd) {
		this.app = app;
		this.plugin = plugin;
	}

	/**
	 * Handles the vault rename event.
	 */
	onRename = (file: TAbstractFile, oldPath: string): void => {
		const isFileRename = this.isFileRename(file, oldPath);
		const isFolderRename = this.isFolderRename(file, oldPath);
		
		if (!isFileRename && !isFolderRename) {
			return;
		}

		const newPath = file.path;
		const renameType = isFileRename ? "file" : "folder";
		
		log.logMessage(`QuickAdd: ${renameType} renamed from "${oldPath}" to "${newPath}"`);
		
		// Check if auto-rename is enabled
		if (!this.isAutoRenameEnabled(isFileRename)) {
			log.logMessage(`QuickAdd: Auto-rename for ${renameType}s is disabled, skipping update`);
			return;
		}

		this.updateChoicesForPathRename(oldPath, newPath, isFileRename);
	};

	/**
	 * Updates all affected choices when a file or folder is renamed.
	 */
	private updateChoicesForPathRename(oldPath: string, newPath: string, isFileRename: boolean): void {
		try {
			const currentSettings = settingsStore.getState();
			const currentChoices = currentSettings.choices;

			// Find affected choices for user notification
			const affectedChoices = isFileRename 
				? FolderPathUpdater.findChoicesWithFilePath(currentChoices, oldPath)
				: FolderPathUpdater.findChoicesWithFolderPath(currentChoices, oldPath);

			// Check for affected global settings (only for folder renames)
			let globalSettingsAffected = false;
			if (!isFileRename && this.isGlobalSettingsAutoRenameEnabled()) {
				globalSettingsAffected = this.checkGlobalSettingsAffected(oldPath);
			}

			if (affectedChoices.length === 0 && !globalSettingsAffected) {
				const pathType = isFileRename ? "file" : "folder";
				log.logMessage(`QuickAdd: No choices or global settings affected by ${pathType} rename from "${oldPath}" to "${newPath}"`);
				return;
			}

			// Create backup of current settings
			const settingsBackup = structuredClone(currentSettings);

			try {
				let updatedSettings = { ...currentSettings };

				// Update the choices if any are affected
				if (affectedChoices.length > 0) {
					// Get settings for options
					const settings = settingsStore.getState();
					const options = {
						updateUserScripts: settings.autoRenameUserScripts ?? true,
						updateFormatStrings: settings.autoRenameFormatReferences ?? true,
						updateDirectPaths: true // Always enabled for basic functionality
					};

					const updatedChoices = isFileRename
						? FolderPathUpdater.updateChoicesFilePaths(currentChoices, oldPath, newPath, options)
						: FolderPathUpdater.updateChoicesFolderPaths(currentChoices, oldPath, newPath, options);
					
					updatedSettings.choices = updatedChoices;
				}

				// Update global settings if affected
				if (globalSettingsAffected) {
					updatedSettings = this.updateGlobalSettings(updatedSettings, oldPath, newPath);
				}

				// Apply all updates
				settingsStore.setState(updatedSettings);

				// Log successful update
				const pathType = isFileRename ? "file" : "folder";
				const totalAffected = affectedChoices.length + (globalSettingsAffected ? 1 : 0);
				const affectedType = affectedChoices.length > 0 && globalSettingsAffected 
					? "choice(s) and global settings"
					: affectedChoices.length > 0 
						? "choice(s)" 
						: "global settings";
				
				log.logMessage(
					`QuickAdd: Successfully updated ${totalAffected} ${affectedType} for ${pathType} rename from "${oldPath}" to "${newPath}"`
				);

				// Show notification to user if enabled
				this.showUpdateNotification(affectedChoices.length, oldPath, newPath, isFileRename);

			} catch (updateError) {
				// Restore backup on error
				settingsStore.setState(settingsBackup);
				log.logError(`QuickAdd: Failed to update choices for path rename: ${updateError}`);
				this.showErrorNotification(oldPath, newPath, isFileRename);
			}

		} catch (error) {
			log.logError(`QuickAdd: Error handling path rename: ${error}`);
		}
	}

	/**
	 * Checks if the rename event is for a file.
	 */
	private isFileRename(file: TAbstractFile, oldPath: string): boolean {
		// Check if the new file is a file (not a folder)
		if (file instanceof TFile) {
			return true;
		}

		// Additional check using file extension heuristic
		return this.looksLikeFilePath(oldPath) && !this.looksLikeFolderPath(oldPath);
	}

	/**
	 * Checks if the rename event is for a folder.
	 */
	private isFolderRename(file: TAbstractFile, oldPath: string): boolean {
		// Check if the new file is a folder
		if (file instanceof TFolder) {
			return true;
		}

		// Additional check using the old path (in case file object type is ambiguous)
		// This handles edge cases where the file type might not be correctly determined
		return isFolder(this.app, file.path) || this.looksLikeFolderPath(oldPath);
	}

	/**
	 * Heuristic to determine if a path looks like a file path.
	 */
	private looksLikeFilePath(path: string): boolean {
		const lastSlashIndex = path.lastIndexOf("/");
		const lastPart = lastSlashIndex >= 0 ? path.substring(lastSlashIndex + 1) : path;
		
		// Has a file extension
		return lastPart.includes(".") && !lastPart.startsWith(".");
	}

	/**
	 * Heuristic to determine if a path looks like a folder path.
	 */
	private looksLikeFolderPath(path: string): boolean {
		// If path doesn't have a file extension, it's likely a folder
		const lastSlashIndex = path.lastIndexOf("/");
		const lastPart = lastSlashIndex >= 0 ? path.substring(lastSlashIndex + 1) : path;
		
		// No dot or dot at the beginning (hidden folder) suggests it's a folder
		return !lastPart.includes(".") || lastPart.startsWith(".");
	}

	/**
	 * Checks if auto-rename feature is enabled in settings.
	 */
	private isAutoRenameEnabled(isFileRename: boolean): boolean {
		const settings = settingsStore.getState();
		
		if (isFileRename) {
			// Check file-specific settings
			return settings.autoRenameTemplateFiles ?? true;
		} else {
			// Check folder-specific settings
			return settings.autoRenameDestinationFolders ?? true;
		}
	}

	/**
	 * Checks if global settings auto-rename is enabled.
	 */
	private isGlobalSettingsAutoRenameEnabled(): boolean {
		const settings = settingsStore.getState();
		return settings.autoRenameGlobalSettings ?? true;
	}

	/**
	 * Checks if the renamed path affects any global settings.
	 */
	private checkGlobalSettingsAffected(oldPath: string): boolean {
		const settings = settingsStore.getState();
		
		// Check templateFolderPath
		if (settings.templateFolderPath && this.pathReferencesTarget(settings.templateFolderPath, oldPath, false)) {
			return true;
		}
		
		// Check ai.promptTemplatesFolderPath
		if (settings.ai?.promptTemplatesFolderPath && 
			this.pathReferencesTarget(settings.ai.promptTemplatesFolderPath, oldPath, false)) {
			return true;
		}
		
		return false;
	}

	/**
	 * Updates global settings with new folder paths.
	 */
	private updateGlobalSettings(currentSettings: any, oldPath: string, newPath: string): any {
		const updatedSettings = { ...currentSettings };
		
		// Update templateFolderPath if affected
		if (currentSettings.templateFolderPath && 
			this.pathReferencesTarget(currentSettings.templateFolderPath, oldPath, false)) {
			updatedSettings.templateFolderPath = this.updatePath(
				currentSettings.templateFolderPath, oldPath, newPath, false
			);
		}
		
		// Update ai.promptTemplatesFolderPath if affected
		if (currentSettings.ai?.promptTemplatesFolderPath && 
			this.pathReferencesTarget(currentSettings.ai.promptTemplatesFolderPath, oldPath, false)) {
			updatedSettings.ai = {
				...currentSettings.ai,
				promptTemplatesFolderPath: this.updatePath(
					currentSettings.ai.promptTemplatesFolderPath, oldPath, newPath, false
				)
			};
		}
		
		return updatedSettings;
	}

	/**
	 * Checks if a path references a specific target path.
	 */
	private pathReferencesTarget(path: string, targetPath: string, isFileTarget: boolean): boolean {
		if (!path || !targetPath) {
			return false;
		}

		const normalizedPath = PathNormalizer.normalize(path);
		const normalizedTarget = PathNormalizer.normalize(targetPath);

		if (isFileTarget) {
			// For file targets, only exact matches
			return normalizedPath === normalizedTarget;
		} else {
			// For folder targets, exact match or if path is within the folder
			return (
				normalizedPath === normalizedTarget ||
				PathNormalizer.isSubfolderOf(normalizedPath, normalizedTarget)
			);
		}
	}

	/**
	 * Updates a path by replacing the old reference with the new one.
	 */
	private updatePath(path: string, oldPath: string, newPath: string, isFileRename: boolean): string {
		const normalizedPath = PathNormalizer.normalize(path);
		const normalizedOld = PathNormalizer.normalize(oldPath);
		const normalizedNew = PathNormalizer.normalize(newPath);

		if (isFileRename) {
			// For file renames, only update exact matches
			if (normalizedPath === normalizedOld) {
				return newPath;
			}
		} else {
			// For folder renames, update exact matches and subpaths
			if (normalizedPath === normalizedOld) {
				return newPath;
			} else if (PathNormalizer.isSubfolderOf(normalizedPath, normalizedOld)) {
				const remainingPath = normalizedPath.substring(normalizedOld.length + 1);
				return normalizedNew + "/" + remainingPath;
			}
		}

		return path;
	}

	/**
	 * Shows a success notification to the user.
	 */
	private showUpdateNotification(count: number, oldPath: string, newPath: string, isFileRename: boolean): void {
		const settings = settingsStore.getState();
		
		// Check if notifications are enabled
		if (settings.showAutoRenameNotifications === false) {
			return;
		}

		const pathType = isFileRename ? "file" : "folder";
		let message = `QuickAdd: Updated ${count} choice${count > 1 ? 's' : ''} after ${pathType} rename\n"${oldPath}" → "${newPath}"`;
		
		// Check if global settings were also updated
		if (this.isGlobalSettingsAutoRenameEnabled() && this.checkGlobalSettingsAffected(oldPath)) {
			message += "\nGlobal settings were also updated.";
		}
		
		// Use Obsidian's notice system
		// biome-ignore lint/style/noNonNullAssertion: app is always available in plugin context
		new Notice(message, 5000);
	}

	/**
	 * Shows an error notification to the user.
	 */
	private showErrorNotification(oldPath: string, newPath: string, isFileRename: boolean): void {
		const pathType = isFileRename ? "file" : "folder";
		const message = `QuickAdd: Failed to update choices after ${pathType} rename\n"${oldPath}" → "${newPath}"\nPlease update manually if needed.`;
		
		// biome-ignore lint/style/noNonNullAssertion: app is always available in plugin context
		new Notice(message, 8000);
	}
}