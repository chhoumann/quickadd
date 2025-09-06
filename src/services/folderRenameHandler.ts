import type { App, TAbstractFile } from "obsidian";
import { Notice, TFolder } from "obsidian";
import { log } from "../logger/logManager";
import type QuickAdd from "../main";
import { settingsStore } from "../settingsStore";
import { isFolder } from "../utilityObsidian";
import { FolderPathUpdater } from "../utils/folderPathUpdater";

/**
 * Handles folder rename events and automatically updates QuickAdd choice configurations.
 */
export class FolderRenameHandler {
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
		// Only process folder renames
		if (!this.isFolderRename(file, oldPath)) {
			return;
		}

		const newPath = file.path;
		
		log.logMessage(`QuickAdd: Folder renamed from "${oldPath}" to "${newPath}"`);
		
		// Check if auto-rename is enabled
		if (!this.isAutoRenameEnabled()) {
			log.logMessage("QuickAdd: Auto-rename is disabled, skipping update");
			return;
		}

		this.updateChoicesForFolderRename(oldPath, newPath);
	};

	/**
	 * Updates all affected choices when a folder is renamed.
	 */
	private updateChoicesForFolderRename(oldPath: string, newPath: string): void {
		try {
			const currentSettings = settingsStore.getState();
			const currentChoices = currentSettings.choices;

			// Find affected choices for user notification
			const affectedChoices = FolderPathUpdater.findChoicesWithFolderPath(
				currentChoices,
				oldPath
			);

			if (affectedChoices.length === 0) {
				log.logMessage(`QuickAdd: No choices affected by folder rename from "${oldPath}" to "${newPath}"`);
				return;
			}

			// Create backup of current settings
			const settingsBackup = structuredClone(currentSettings);

			try {
				// Update the choices
				const updatedChoices = FolderPathUpdater.updateChoicesFolderPaths(
					currentChoices,
					oldPath,
					newPath
				);

				// Apply the updates
				settingsStore.setState({
					...currentSettings,
					choices: updatedChoices,
				});

				// Log successful update
				log.logMessage(
					`QuickAdd: Successfully updated ${affectedChoices.length} choice(s) for folder rename from "${oldPath}" to "${newPath}"`
				);

				// Show notification to user if enabled
				this.showUpdateNotification(affectedChoices.length, oldPath, newPath);

			} catch (updateError) {
				// Restore backup on error
				settingsStore.setState(settingsBackup);
				log.logError(`QuickAdd: Failed to update choices for folder rename: ${updateError}`);
				this.showErrorNotification(oldPath, newPath);
			}

		} catch (error) {
			log.logError(`QuickAdd: Error handling folder rename: ${error}`);
		}
	}

	/**
	 * Checks if the rename event is for a folder (not a file).
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
	private isAutoRenameEnabled(): boolean {
		const settings = settingsStore.getState();
		// Default to enabled if setting doesn't exist yet
		return settings.autoRenameDestinationFolders ?? true;
	}

	/**
	 * Shows a success notification to the user.
	 */
	private showUpdateNotification(count: number, oldPath: string, newPath: string): void {
		const settings = settingsStore.getState();
		
		// Check if notifications are enabled
		if (settings.showAutoRenameNotifications === false) {
			return;
		}

		const message = `QuickAdd: Updated ${count} choice${count > 1 ? 's' : ''} after folder rename\n"${oldPath}" → "${newPath}"`;
		
		// Use Obsidian's notice system
		// biome-ignore lint/style/noNonNullAssertion: app is always available in plugin context
		new Notice(message, 5000);
	}

	/**
	 * Shows an error notification to the user.
	 */
	private showErrorNotification(oldPath: string, newPath: string): void {
		const message = `QuickAdd: Failed to update choices after folder rename\n"${oldPath}" → "${newPath}"\nPlease update manually if needed.`;
		
		// biome-ignore lint/style/noNonNullAssertion: app is always available in plugin context
		new Notice(message, 8000);
	}
}