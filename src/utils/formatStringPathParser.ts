import { TEMPLATE_REGEX, FIELD_VAR_REGEX_WITH_FILTERS } from "../constants";
import { FieldSuggestionParser, type FieldFilter } from "./FieldSuggestionParser";

/**
 * Parses and updates file/folder path references in QuickAdd format strings.
 * Handles {{TEMPLATE:path}} syntax and {{FIELD:name|folder:path}} filters.
 */
export class FormatStringPathParser {
	/**
	 * Extracts all template file paths from a format string.
	 */
	static parseTemplateReferences(formatString: string): string[] {
		const templatePaths: string[] = [];
		
		// Use global regex to find all matches
		const regex = new RegExp(TEMPLATE_REGEX.source, "gi");
		let match: RegExpExecArray | null;
		
		while ((match = regex.exec(formatString)) !== null) {
			if (match[1]) {
				templatePaths.push(match[1]);
			}
		}
		
		return templatePaths;
	}

	/**
	 * Extracts all folder paths from field filter syntax in a format string.
	 */
	static parseFieldFolderFilters(formatString: string): string[] {
		const folderPaths: string[] = [];
		
		// Use global regex to find all field references
		const regex = new RegExp(FIELD_VAR_REGEX_WITH_FILTERS.source, "gi");
		let match: RegExpExecArray | null;
		
		while ((match = regex.exec(formatString)) !== null) {
			if (match[1]) {
				// The full field syntax includes both the field name and filters
				const fullFieldSyntax = match[1] + (match[2] || "");
				
				try {
					// Parse the field syntax to extract filters
					const { filters } = FieldSuggestionParser.parse(fullFieldSyntax);
					
					// Collect folder and exclude-folder paths
					if (filters.folder) {
						folderPaths.push(filters.folder);
					}
					if (filters.excludeFolders) {
						folderPaths.push(...filters.excludeFolders);
					}
				} catch (error) {
					// Skip invalid field syntax
					continue;
				}
			}
		}
		
		return folderPaths;
	}

	/**
	 * Updates template references in a format string when a file/folder is renamed.
	 */
	static updateTemplateReferences(
		formatString: string,
		oldPath: string,
		newPath: string,
		isFileRename: boolean
	): string {
		const regex = new RegExp(TEMPLATE_REGEX.source, "gi");
		
		return formatString.replace(regex, (fullMatch, templatePath) => {
			const updatedPath = this.updateSinglePath(templatePath, oldPath, newPath, isFileRename);
			return fullMatch.replace(templatePath, updatedPath);
		});
	}

	/**
	 * Updates field folder filters in a format string when a folder is renamed.
	 */
	static updateFieldFolderFilters(
		formatString: string,
		oldPath: string,
		newPath: string
	): string {
		const regex = new RegExp(FIELD_VAR_REGEX_WITH_FILTERS.source, "gi");
		
		return formatString.replace(regex, (fullMatch, fieldWithFilters) => {
			const { fieldName, filters } = FieldSuggestionParser.parse(fieldWithFilters);
			
			// Update folder filter
			if (filters.folder && this.pathReferencesFolder(filters.folder, oldPath)) {
				filters.folder = this.updateSinglePath(filters.folder, oldPath, newPath, false);
			}
			
			// Update exclude-folder filters
			if (filters.excludeFolders) {
				filters.excludeFolders = filters.excludeFolders.map(folder =>
					this.pathReferencesFolder(folder, oldPath)
						? this.updateSinglePath(folder, oldPath, newPath, false)
						: folder
				);
			}
			
			// Reconstruct the field syntax
			const updatedFieldString = this.reconstructFieldSyntax(fieldName, filters);
			return `{{FIELD:${updatedFieldString}}}`;
		});
	}

	/**
	 * Updates all path references in a format string.
	 */
	static updateAllPathReferences(
		formatString: string,
		oldPath: string,
		newPath: string,
		isFileRename: boolean
	): string {
		let updated = formatString;
		
		// Update template references (for both file and folder renames)
		updated = this.updateTemplateReferences(updated, oldPath, newPath, isFileRename);
		
		// Update field folder filters (only for folder renames)
		if (!isFileRename) {
			updated = this.updateFieldFolderFilters(updated, oldPath, newPath);
		}
		
		return updated;
	}

	/**
	 * Checks if a path references a specific folder (exact match or subfolder).
	 */
	private static pathReferencesFolder(path: string, folderPath: string): boolean {
		if (!path || !folderPath) {
			return false;
		}

		const normalizedPath = this.normalizePath(path);
		const normalizedFolder = this.normalizePath(folderPath);

		return (
			normalizedPath === normalizedFolder ||
			normalizedPath.startsWith(normalizedFolder + "/")
		);
	}

	/**
	 * Updates a single path by replacing the old reference with the new one.
	 */
	private static updateSinglePath(
		path: string,
		oldPath: string,
		newPath: string,
		isFileRename: boolean
	): string {
		if (!path || !oldPath || !newPath) {
			return path;
		}

		const normalizedPath = this.normalizePath(path);
		const normalizedOld = this.normalizePath(oldPath);
		const normalizedNew = this.normalizePath(newPath);

		if (isFileRename) {
			// For file renames, only update exact matches
			if (normalizedPath === normalizedOld) {
				return newPath;
			}
		} else {
			// For folder renames, update exact matches and subpaths
			if (normalizedPath === normalizedOld) {
				return newPath;
			} else if (normalizedPath.startsWith(normalizedOld + "/")) {
				const remainingPath = normalizedPath.substring(normalizedOld.length + 1);
				return normalizedNew + "/" + remainingPath;
			}
		}

		return path;
	}

	/**
	 * Reconstructs field syntax string from field name and filters.
	 */
	private static reconstructFieldSyntax(fieldName: string, filters: FieldFilter): string {
		const parts = [fieldName];

		if (filters.folder) {
			parts.push(`folder:${filters.folder}`);
		}
		if (filters.tags) {
			filters.tags.forEach(tag => parts.push(`tag:${tag}`));
		}
		if (filters.inline !== undefined) {
			parts.push(`inline:${filters.inline}`);
		}
		if (filters.defaultValue !== undefined) {
			parts.push(`default:${filters.defaultValue}`);
		}
		if (filters.defaultEmpty !== undefined) {
			parts.push(`default-empty:${filters.defaultEmpty}`);
		}
		if (filters.defaultAlways !== undefined) {
			parts.push(`default-always:${filters.defaultAlways}`);
		}
		if (filters.caseSensitive !== undefined) {
			parts.push(`case-sensitive:${filters.caseSensitive}`);
		}
		if (filters.excludeFolders) {
			filters.excludeFolders.forEach(folder => parts.push(`exclude-folder:${folder}`));
		}
		if (filters.excludeTags) {
			filters.excludeTags.forEach(tag => parts.push(`exclude-tag:${tag}`));
		}
		if (filters.excludeFiles) {
			filters.excludeFiles.forEach(file => parts.push(`exclude-file:${file}`));
		}

		return parts.join("|");
	}

	/**
	 * Normalizes a path for consistent comparison.
	 */
	private static normalizePath(path: string): string {
		if (!path) {
			return "";
		}

		// Remove trailing slashes and normalize separators
		return path.replace(/\/+$/, "").replace(/\\+/g, "/");
	}
}