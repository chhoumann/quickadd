import type { App, TAbstractFile } from "obsidian";
import { Notice, TFile, TFolder } from "obsidian";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";
import { isFolder } from "../utilityObsidian";
import { FolderPathUpdater } from "../utils/folderPathUpdater";

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

			if (affectedChoices.length === 0) {
				const pathType = isFileRename ? "file" : "folder";
				log.logMessage(`QuickAdd: No choices affected by ${pathType} rename from "${oldPath}" to "${newPath}"`);
				return;
			}

			// Create backup of current settings
			const settingsBackup = structuredClone(currentSettings);

			try {
				// Update the choices
				const updatedChoices = isFileRename
					? FolderPathUpdater.updateChoicesFilePaths(currentChoices, oldPath, newPath)
					: FolderPathUpdater.updateChoicesFolderPaths(currentChoices, oldPath, newPath);

				// Apply the updates
				settingsStore.setState({
					...currentSettings,
					choices: updatedChoices,
				});

				// Log successful update
				const pathType = isFileRename ? "file" : "folder";
				log.logMessage(
					`QuickAdd: Successfully updated ${affectedChoices.length} choice(s) for ${pathType} rename from "${oldPath}" to "${newPath}"`
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
	 * Shows a success notification to the user.
	 */
	private showUpdateNotification(count: number, oldPath: string, newPath: string, isFileRename: boolean): void {
		const settings = settingsStore.getState();
		
		// Check if notifications are enabled
		if (settings.showAutoRenameNotifications === false) {
			return;
		}

		const pathType = isFileRename ? "file" : "folder";
		const message = `QuickAdd: Updated ${count} choice${count > 1 ? 's' : ''} after ${pathType} rename\n"${oldPath}" → "${newPath}"`;
		
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