import type IChoice from "../types/choices/IChoice";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import type IMacroChoice from "../types/choices/IMacroChoice";
import type { IUserScript } from "../types/macros/IUserScript";
import type { IOpenFileCommand } from "../types/macros/QuickCommands/IOpenFileCommand";
import { CommandType } from "../types/macros/CommandType";
import { FormatStringPathParser } from "./formatStringPathParser";
import { PathNormalizer } from "./pathNormalizer";

/**
 * Options for controlling which types of updates are performed during path renames.
 */
export interface UpdateOptions {
	/** Whether to update user script file paths */
	updateUserScripts: boolean;
	/** Whether to update format string references */
	updateFormatStrings: boolean;
	/** Whether to update direct file and folder paths */
	updateDirectPaths: boolean;
}

/**
 * Updates file and folder paths in QuickAdd choices when files/folders are renamed.
 * Handles recursive traversal of Multi choices, format strings, and preserves format tokens.
 */
export class FolderPathUpdater {
	/**
	 * Updates all folder path references in choices from oldPath to newPath.
	 */
	static updateChoicesFolderPaths(
		choices: IChoice[],
		oldPath: string,
		newPath: string,
		options: UpdateOptions = { updateUserScripts: true, updateFormatStrings: true, updateDirectPaths: true }
	): IChoice[] {
		if (!this.isValidFolderPathUpdate(oldPath, newPath)) {
			return choices;
		}

		return choices.map(choice => this.updateSingleChoice(choice, oldPath, newPath, false, options));
	}

	/**
	 * Updates all file path references in choices from oldPath to newPath.
	 */
	static updateChoicesFilePaths(
		choices: IChoice[],
		oldPath: string,
		newPath: string,
		options: UpdateOptions = { updateUserScripts: true, updateFormatStrings: true, updateDirectPaths: true }
	): IChoice[] {
		if (!this.isValidFilePathUpdate(oldPath, newPath)) {
			return choices;
		}

		return choices.map(choice => this.updateSingleChoice(choice, oldPath, newPath, true, options));
	}

	/**
	 * Finds all choices that reference a specific folder path.
	 */
	static findChoicesWithFolderPath(choices: IChoice[], folderPath: string): IChoice[] {
		return this.findChoicesWithPath(choices, folderPath, false);
	}

	/**
	 * Finds all choices that reference a specific file path.
	 */
	static findChoicesWithFilePath(choices: IChoice[], filePath: string): IChoice[] {
		return this.findChoicesWithPath(choices, filePath, true);
	}

	/**
	 * Finds all choices that reference a specific path (file or folder).
	 */
	private static findChoicesWithPath(choices: IChoice[], path: string, isFile: boolean): IChoice[] {
		const affectedChoices: IChoice[] = [];

		for (const choice of choices) {
			if (this.choiceReferencesPath(choice, path, isFile)) {
				affectedChoices.push(choice);
			}

			// Recursively check Multi choices
			if (choice.type === "Multi") {
				const multiChoice = choice as IMultiChoice;
				const nestedAffected = this.findChoicesWithPath(
					multiChoice.choices,
					path,
					isFile
				);
				affectedChoices.push(...nestedAffected);
			}
		}

		return affectedChoices;
	}

	/**
	 * Validates that a folder path update is safe to perform.
	 */
	static isValidFolderPathUpdate(oldPath: string, newPath: string): boolean {
		return this.isValidPathUpdate(oldPath, newPath);
	}

	/**
	 * Validates that a file path update is safe to perform.
	 */
	static isValidFilePathUpdate(oldPath: string, newPath: string): boolean {
		return this.isValidPathUpdate(oldPath, newPath);
	}

	/**
	 * Validates that a path update is safe to perform.
	 */
	private static isValidPathUpdate(oldPath: string, newPath: string): boolean {
		// Both paths must be non-empty
		if (!oldPath || !newPath) {
			return false;
		}

		// Paths must be different
		if (oldPath === newPath) {
			return false;
		}

		// Normalize paths for comparison (with cross-platform support)
		const normalizedOld = PathNormalizer.normalize(oldPath);
		const normalizedNew = PathNormalizer.normalize(newPath);

		return normalizedOld !== normalizedNew;
	}

	/**
	 * Updates a single choice's path references.
	 */
	private static updateSingleChoice(
		choice: IChoice,
		oldPath: string,
		newPath: string,
		isFileRename: boolean,
		options: UpdateOptions
	): IChoice {
		switch (choice.type) {
			case "Capture":
				return this.updateCaptureChoice(choice as ICaptureChoice, oldPath, newPath, isFileRename, options);
			case "Template":
				return this.updateTemplateChoice(choice as ITemplateChoice, oldPath, newPath, isFileRename, options);
			case "Multi":
				return this.updateMultiChoice(choice as IMultiChoice, oldPath, newPath, isFileRename, options);
			case "Macro":
				return this.updateMacroChoice(choice as IMacroChoice, oldPath, newPath, isFileRename, options);
			default:
				return choice;
		}
	}

	/**
	 * Updates path references in a Capture choice.
	 */
	private static updateCaptureChoice(
		choice: ICaptureChoice,
		oldPath: string,
		newPath: string,
		isFileRename: boolean,
		options: UpdateOptions
	): ICaptureChoice {
		const updatedChoice = { ...choice };

		// Update captureTo field if it references the path (only if direct paths are enabled)
		if (options.updateDirectPaths && this.pathReferencesTarget(choice.captureTo, oldPath, isFileRename)) {
			updatedChoice.captureTo = this.updatePath(choice.captureTo, oldPath, newPath, isFileRename);
		}

		// Update template field in createFileIfItDoesntExist (only if direct paths are enabled)
		if (options.updateDirectPaths && choice.createFileIfItDoesntExist?.template) {
			if (this.pathReferencesTarget(choice.createFileIfItDoesntExist.template, oldPath, true)) {
				updatedChoice.createFileIfItDoesntExist = {
					...choice.createFileIfItDoesntExist,
					template: this.updatePath(choice.createFileIfItDoesntExist.template, oldPath, newPath, true)
				};
			}
		}

		// Update format strings (only if format strings are enabled)
		if (options.updateFormatStrings && choice.format?.format) {
			const updatedFormat = FormatStringPathParser.updateAllPathReferences(
				choice.format.format,
				oldPath,
				newPath,
				isFileRename
			);
			if (updatedFormat !== choice.format.format) {
				updatedChoice.format = {
					...choice.format,
					format: updatedFormat
				};
			}
		}

		return updatedChoice;
	}

	/**
	 * Updates path references in a Template choice.
	 */
	private static updateTemplateChoice(
		choice: ITemplateChoice,
		oldPath: string,
		newPath: string,
		isFileRename: boolean,
		options: UpdateOptions
	): ITemplateChoice {
		const updatedChoice = { ...choice };

		// Update templatePath field for file renames (only if direct paths are enabled)
		if (options.updateDirectPaths && isFileRename && this.pathReferencesTarget(choice.templatePath, oldPath, true)) {
			updatedChoice.templatePath = this.updatePath(choice.templatePath, oldPath, newPath, true);
		}
		// Update templatePath field for folder renames (if template is in renamed folder, only if direct paths are enabled)
		else if (options.updateDirectPaths && !isFileRename && this.pathReferencesTarget(choice.templatePath, oldPath, false)) {
			updatedChoice.templatePath = this.updatePath(choice.templatePath, oldPath, newPath, false);
		}

		// Update folder.folders array for folder renames (only if direct paths are enabled)
		if (options.updateDirectPaths && !isFileRename && choice.folder?.folders) {
			const updatedFolders = choice.folder.folders.map(folderPath =>
				this.pathReferencesTarget(folderPath, oldPath, false)
					? this.updatePath(folderPath, oldPath, newPath, false)
					: folderPath
			);
			
			if (JSON.stringify(updatedFolders) !== JSON.stringify(choice.folder.folders)) {
				updatedChoice.folder = {
					...choice.folder,
					folders: updatedFolders,
				};
			}
		}

		// Update format strings in fileNameFormat (only if format strings are enabled)
		if (options.updateFormatStrings && choice.fileNameFormat?.format) {
			const updatedFormat = FormatStringPathParser.updateAllPathReferences(
				choice.fileNameFormat.format,
				oldPath,
				newPath,
				isFileRename
			);
			if (updatedFormat !== choice.fileNameFormat.format) {
				updatedChoice.fileNameFormat = {
					...choice.fileNameFormat,
					format: updatedFormat
				};
			}
		}

		return updatedChoice;
	}

	/**
	 * Updates path references in a Multi choice (recursively).
	 */
	private static updateMultiChoice(
		choice: IMultiChoice,
		oldPath: string,
		newPath: string,
		isFileRename: boolean,
		options: UpdateOptions
	): IMultiChoice {
		return {
			...choice,
			choices: choice.choices.map(c => this.updateSingleChoice(c, oldPath, newPath, isFileRename, options)),
		};
	}

	/**
	 * Updates path references in a Macro choice.
	 */
	private static updateMacroChoice(
		choice: IMacroChoice,
		oldPath: string,
		newPath: string,
		isFileRename: boolean,
		options: UpdateOptions
	): IMacroChoice {
		const updatedChoice = { ...choice };
		let hasChanges = false;

		// Update user script commands in the macro (only if user scripts are enabled)
		if (choice.macro?.commands) {
			const updatedCommands = choice.macro.commands.map(command => {
				if (command.type === CommandType.UserScript) {
					const userScript = command as IUserScript;
					if (options.updateUserScripts && this.pathReferencesTarget(userScript.path, oldPath, true)) {
						hasChanges = true;
						return {
							...userScript,
							path: this.updatePath(userScript.path, oldPath, newPath, true)
						};
					}
				} else if (command.type === CommandType.OpenFile) {
					const openFileCommand = command as IOpenFileCommand;
					// Check both direct path references and format strings in filePath
					if (options.updateDirectPaths && this.pathReferencesTarget(openFileCommand.filePath, oldPath, isFileRename)) {
						hasChanges = true;
						return {
							...openFileCommand,
							filePath: this.updatePath(openFileCommand.filePath, oldPath, newPath, isFileRename)
						};
					} else if (options.updateFormatStrings) {
						// Check for format string references (only if format strings are enabled)
						const updatedFilePath = FormatStringPathParser.updateAllPathReferences(
							openFileCommand.filePath,
							oldPath,
							newPath,
							isFileRename
						);
						if (updatedFilePath !== openFileCommand.filePath) {
							hasChanges = true;
							return {
								...openFileCommand,
								filePath: updatedFilePath
							};
						}
					}
				}
				return command;
			});

			if (hasChanges) {
				updatedChoice.macro = {
					...choice.macro,
					commands: updatedCommands
				};
			}
		}

		return updatedChoice;
	}

	/**
	 * Checks if a choice references a specific path.
	 */
	private static choiceReferencesPath(choice: IChoice, path: string, isFile: boolean): boolean {
		switch (choice.type) {
			case "Capture":
				const captureChoice = choice as ICaptureChoice;
				return this.captureChoiceReferencesPath(captureChoice, path, isFile);
			case "Template":
				const templateChoice = choice as ITemplateChoice;
				return this.templateChoiceReferencesPath(templateChoice, path, isFile);
			case "Macro":
				const macroChoice = choice as IMacroChoice;
				return this.macroChoiceReferencesPath(macroChoice, path, isFile);
			case "Multi":
				// Multi choices themselves don't reference paths, but their nested choices might
				return false;
			default:
				return false;
		}
	}

	/**
	 * Checks if a Capture choice references a specific path.
	 */
	private static captureChoiceReferencesPath(choice: ICaptureChoice, path: string, isFile: boolean): boolean {
		// Check captureTo field
		if (this.pathReferencesTarget(choice.captureTo, path, isFile)) {
			return true;
		}
		
		// Check template field
		if (choice.createFileIfItDoesntExist?.template && 
			this.pathReferencesTarget(choice.createFileIfItDoesntExist.template, path, true)) {
			return true;
		}
		
		// Check format strings
		if (choice.format?.format && this.formatStringReferencesPath(choice.format.format, path, isFile)) {
			return true;
		}
		
		return false;
	}

	/**
	 * Checks if a Template choice references a specific path.
	 */
	private static templateChoiceReferencesPath(choice: ITemplateChoice, path: string, isFile: boolean): boolean {
		// Check templatePath field
		if (this.pathReferencesTarget(choice.templatePath, path, isFile)) {
			return true;
		}
		
		// Check folder.folders array (only for folder references)
		if (!isFile && choice.folder?.folders?.some(folder =>
			this.pathReferencesTarget(folder, path, false)
		)) {
			return true;
		}
		
		// Check format strings
		if (choice.fileNameFormat?.format && 
			this.formatStringReferencesPath(choice.fileNameFormat.format, path, isFile)) {
			return true;
		}
		
		return false;
	}

	/**
	 * Checks if a Macro choice references a specific path.
	 */
	private static macroChoiceReferencesPath(choice: IMacroChoice, path: string, isFile: boolean): boolean {
		if (!choice.macro?.commands) {
			return false;
		}
		
		return choice.macro.commands.some(command => {
			if (command.type === CommandType.UserScript) {
				const userScript = command as IUserScript;
				return this.pathReferencesTarget(userScript.path, path, true);
			} else if (command.type === CommandType.OpenFile) {
				const openFileCommand = command as IOpenFileCommand;
				return this.pathReferencesTarget(openFileCommand.filePath, path, isFile) ||
					   this.formatStringReferencesPath(openFileCommand.filePath, path, isFile);
			}
			return false;
		});
	}

	/**
	 * Checks if a format string contains path references.
	 */
	private static formatStringReferencesPath(formatString: string, path: string, isFile: boolean): boolean {
		// Check template references
		const templatePaths = FormatStringPathParser.parseTemplateReferences(formatString);
		if (templatePaths.some(templatePath => this.pathReferencesTarget(templatePath, path, isFile))) {
			return true;
		}
		
		// Check field folder filters (only for folder references)
		if (!isFile) {
			const folderPaths = FormatStringPathParser.parseFieldFolderFilters(formatString);
			if (folderPaths.some(folderPath => this.pathReferencesTarget(folderPath, path, false))) {
				return true;
			}
		}
		
		return false;
	}

	/**
	 * Checks if a path references a specific target (exact match or subfolder for folders).
	 */
	private static pathReferencesTarget(path: string, targetPath: string, isFileTarget: boolean): boolean {
		if (!path || !targetPath) {
			return false;
		}

		// Skip tag-based references (e.g., "#inbox")
		if (path.startsWith("#")) {
			return false;
		}

		const normalizedPath = PathNormalizer.normalize(path);
		const normalizedTarget = PathNormalizer.normalize(targetPath);

		if (isFileTarget) {
			// For file targets, only exact matches
			return normalizedPath === normalizedTarget;
		} else {
			// For folder targets, exact match or subfolder
			return (
				normalizedPath === normalizedTarget ||
				PathNormalizer.isSubfolderOf(normalizedPath, normalizedTarget)
			);
		}
	}

	/**
	 * Updates a path by replacing the old reference with the new one.
	 */
	private static updatePath(
		path: string,
		oldPath: string,
		newPath: string,
		isFileRename: boolean
	): string {
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

}