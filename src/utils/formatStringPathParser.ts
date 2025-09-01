import { TEMPLATE_REGEX, FIELD_VAR_REGEX_WITH_FILTERS } from "../constants";
import { FieldSuggestionParser, type FieldFilter } from "./FieldSuggestionParser";
import { PathNormalizer } from "./pathNormalizer";

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
	 * Uses targeted replacement to preserve unknown filters and original order.
	 */
	static updateFieldFolderFilters(
		formatString: string,
		oldPath: string,
		newPath: string
	): string {
		const regex = new RegExp(FIELD_VAR_REGEX_WITH_FILTERS.source, "gi");
		
		return formatString.replace(regex, (fullMatch, fieldWithFilters) => {
			// Use targeted replacement instead of full reconstruction to preserve unknown filters
			let updatedFieldString = fieldWithFilters;
			
			// Update folder: filter values
			updatedFieldString = this.updateFolderFilterInPlace(updatedFieldString, oldPath, newPath);
			
			// Update exclude-folder: filter values
			updatedFieldString = this.updateExcludeFolderFilterInPlace(updatedFieldString, oldPath, newPath);
			
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

		const normalizedPath = PathNormalizer.normalize(path);
		const normalizedFolder = PathNormalizer.normalize(folderPath);

		return (
			normalizedPath === normalizedFolder ||
			PathNormalizer.isSubfolderOf(normalizedPath, normalizedFolder)
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
	 * Updates folder: filter values in place without affecting other filters.
	 */
	private static updateFolderFilterInPlace(fieldString: string, oldPath: string, newPath: string): string {
		// Match |folder:value patterns (case-insensitive)
		const folderRegex = /(\|folder:)([^|]+)/gi;
		
		return fieldString.replace(folderRegex, (match, prefix, folderPath) => {
			if (this.pathReferencesFolder(folderPath.trim(), oldPath)) {
				const updatedPath = this.updateSinglePath(folderPath.trim(), oldPath, newPath, false);
				return `${prefix}${updatedPath}`;
			}
			return match;
		});
	}

	/**
	 * Updates exclude-folder: filter values in place without affecting other filters.
	 */
	private static updateExcludeFolderFilterInPlace(fieldString: string, oldPath: string, newPath: string): string {
		// Match |exclude-folder:value patterns (case-insensitive)
		const excludeFolderRegex = /(\|exclude-folder:)([^|]+)/gi;
		
		return fieldString.replace(excludeFolderRegex, (match, prefix, folderPath) => {
			if (this.pathReferencesFolder(folderPath.trim(), oldPath)) {
				const updatedPath = this.updateSinglePath(folderPath.trim(), oldPath, newPath, false);
				return `${prefix}${updatedPath}`;
			}
			return match;
		});
	}

	/**
	 * Reconstructs field syntax string from field name and filters.
	 * @deprecated Use updateFolderFilterInPlace and updateExcludeFolderFilterInPlace instead to preserve unknown filters.
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

}