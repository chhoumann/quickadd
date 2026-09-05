import type { TFile, CachedMetadata } from "obsidian";
import type { FieldFilter } from "./FieldSuggestionParser";
import {
	normalizeFrontmatterTagValues,
	normalizeTag,
} from "./tagNormalizer";

export class FieldSuggestionFileFilter {
	/**
	 * Enhanced file filtering with inclusion and exclusion support
	 */
	static filterFiles(
		files: TFile[],
		filters: FieldFilter,
		metadataCache: (file: TFile) => CachedMetadata | null,
	): TFile[] {
		const includedFiles = this.applyInclusionFilters(files, filters, metadataCache);
		return this.applyExclusionFilters(includedFiles, filters, metadataCache);
	}

	private static applyInclusionFilters(
		files: TFile[],
		filters: FieldFilter,
		metadataCache: (file: TFile) => CachedMetadata | null,
	): TFile[] {
		let includedFiles = files;

		const folders = this.getIncludeFolders(filters);
		if (folders.length > 0) {
			includedFiles = includedFiles.filter(file =>
				folders.some(folder => this.matchesFolder(file, folder))
			);
		}

		if (filters.tags && filters.tags.length > 0) {
			includedFiles = includedFiles.filter(file =>
				this.matchesTags(file, filters.tags ?? [], metadataCache, "all")
			);
		}

		return includedFiles;
	}

	private static applyExclusionFilters(
		files: TFile[],
		filters: FieldFilter,
		metadataCache: (file: TFile) => CachedMetadata | null,
	): TFile[] {
		return files.filter(file => {
			// Exclude by folder
			if (filters.excludeFolders && filters.excludeFolders.length > 0) {
				if (filters.excludeFolders.some(folder => this.matchesFolder(file, folder))) {
					return false;
				}
			}

			// Exclude by tag
			if (filters.excludeTags && filters.excludeTags.length > 0) {
				if (this.matchesTags(file, filters.excludeTags, metadataCache, "any")) {
					return false;
				}
			}

			// Exclude by specific file
			if (filters.excludeFiles && filters.excludeFiles.length > 0) {
				if (filters.excludeFiles.some(excludeFile => this.matchesFile(file, excludeFile))) {
					return false;
				}
			}

			return true;
		});
	}

	private static getIncludeFolders(filters: FieldFilter): string[] {
		const folders = filters.folders?.length
			? filters.folders
			: filters.folder
				? [filters.folder]
				: [];

		return [...new Set(folders.map(folder => this.normalizePath(folder)).filter(Boolean))];
	}

	private static matchesFolder(file: TFile, folder: string): boolean {
		// Normalize paths for comparison
		const normalizedFolder = this.normalizePath(folder);
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
		mode: "all" | "any",
	): boolean {
		const metadata = metadataCache(file);
		if (!metadata) {
			return false;
		}

		// Get all tags from the file (both frontmatter and inline)
		const fileTags = this.getAllTags(metadata);
		const normalizedRequiredTags = requiredTags
			.map(normalizeTag)
			.filter(Boolean);

		const matchesRequiredTag = (requiredTag: string) =>
			fileTags.some(fileTag =>
				fileTag === requiredTag || fileTag.startsWith(requiredTag + "/")
			);

		return mode === "all"
			? normalizedRequiredTags.every(matchesRequiredTag)
			: normalizedRequiredTags.some(matchesRequiredTag);
	}

	private static matchesFile(file: TFile, targetFile: string): boolean {
		// Match by exact name or path
		return file.name === targetFile || file.path === targetFile;
	}

	private static getAllTags(metadata: CachedMetadata): string[] {
		const tags: string[] = [];

		// Get tags from frontmatter
		if (metadata.frontmatter?.tags) {
			tags.push(...normalizeFrontmatterTagValues(metadata.frontmatter.tags));
		}

		if (metadata.frontmatter?.tag) {
			tags.push(...normalizeFrontmatterTagValues(metadata.frontmatter.tag));
		}

		// Get inline tags
		if (metadata.tags) {
			tags.push(...metadata.tags.map(tag => normalizeTag(tag.tag)));
		}

		return tags.filter(Boolean);
	}

	private static normalizePath(path: string): string {
		// Remove leading/trailing slashes and normalize
		return path.replace(/^\/+|\/+$/g, "");
	}
}
