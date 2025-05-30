import type { TFile, CachedMetadata } from "obsidian";
import type { FieldFilter } from "./FieldSuggestionParser";

export class FieldSuggestionFileFilter {
	/**
	 * Filters files based on the provided filter criteria
	 */
	static filterFiles(
		files: TFile[],
		filters: FieldFilter,
		metadataCache: (file: TFile) => CachedMetadata | null,
	): TFile[] {
		if (Object.keys(filters).length === 0) {
			return files; // No filters, return all files
		}

		return files.filter((file) => {
			// Check folder filter
			if (filters.folder && !this.matchesFolder(file, filters.folder)) {
				return false;
			}

			// Check tag filters
			if (
				filters.tags &&
				filters.tags.length > 0 &&
				!this.matchesTags(file, filters.tags, metadataCache)
			) {
				return false;
			}

			return true;
		});
	}

	private static matchesFolder(file: TFile, folderPath: string): boolean {
		// Normalize paths for comparison
		const normalizedFolder = this.normalizePath(folderPath);
		const normalizedFilePath = this.normalizePath(file.path);

		// Check if file is in the specified folder or its subfolders
		return (
			normalizedFilePath.startsWith(normalizedFolder + "/") ||
			normalizedFilePath.substring(
				0,
				normalizedFilePath.lastIndexOf("/"),
			) === normalizedFolder
		);
	}

	private static matchesTags(
		file: TFile,
		requiredTags: string[],
		metadataCache: (file: TFile) => CachedMetadata | null,
	): boolean {
		const metadata = metadataCache(file);
		if (!metadata || !metadata.tags) {
			return false;
		}

		const fileTags = metadata.tags.map((tag) =>
			tag.tag.startsWith("#") ? tag.tag.substring(1) : tag.tag,
		);

		// Check if file has all required tags
		return requiredTags.every((requiredTag) =>
			fileTags.includes(requiredTag),
		);
	}

	private static normalizePath(path: string): string {
		// Remove leading/trailing slashes and normalize
		return path.replace(/^\/+|\/+$/g, "");
	}
}