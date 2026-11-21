import type { TFile, CachedMetadata } from "obsidian";
import type { FieldFilter } from "./FieldSuggestionParser";
import { isPathWithinFolder, normalizeVaultPathSeparators } from "./pathUtils";
import { noteTags, normalizeTag } from "./tagNormalizer";

/** Whether `filter` narrows which files qualify: a folder, tag or exclude-* filter. */
export function hasFileFilter(filter: FieldFilter): boolean {
	return Boolean(
		filter.folder ||
			filter.folders?.length ||
			filter.tags?.length ||
			filter.excludeFolders?.length ||
			filter.excludeTags?.length ||
			filter.excludeFiles?.length,
	);
}

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
				folders.some(folder => isPathWithinFolder(file.path, folder))
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
		const excludeFolders = this.normalizedFolders(filters.excludeFolders ?? []);
		return files.filter(file =>
			!excludeFolders.some(folder => isPathWithinFolder(file.path, folder)) &&
			!(filters.excludeTags?.length && this.matchesTags(file, filters.excludeTags, metadataCache, "any")) &&
			!(filters.excludeFiles?.length && filters.excludeFiles.some(target => this.matchesFile(file, target)))
		);
	}

	private static getIncludeFolders(filters: FieldFilter): string[] {
		const folders = filters.folders?.length
			? filters.folders
			: filters.folder
				? [filters.folder]
				: [];

		return this.normalizedFolders(folders);
	}

	/** A blank folder (`|exclude-folder:` with no value yet) filters nothing. */
	private static normalizedFolders(folders: string[]): string[] {
		return [...new Set(folders.map(normalizeVaultPathSeparators).filter(Boolean))];
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

		const fileTags = noteTags(metadata);
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
}
