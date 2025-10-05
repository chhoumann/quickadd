import type { TFile, CachedMetadata } from "obsidian";
import type { FieldFilter } from "./FieldSuggestionParser";

/**
 * Enhanced file filtering with inclusion and exclusion support
 */
function filterFiles(
	files: TFile[],
	filters: FieldFilter,
	metadataCache: (file: TFile) => CachedMetadata | null
): TFile[] {
	let filteredFiles = files;

	// Apply inclusion filters first
	filteredFiles = applyInclusionFilters(filteredFiles, filters, metadataCache);

	// Apply exclusion filters
	filteredFiles = applyExclusionFilters(filteredFiles, filters, metadataCache);

	return filteredFiles;
}

function applyInclusionFilters(
	files: TFile[],
	filters: FieldFilter,
	metadataCache: (file: TFile) => CachedMetadata | null
): TFile[] {
	let hasInclusionFilters = false;
	let includedFiles: TFile[] = [];

	// Folder filter
	if (filters.folder) {
		hasInclusionFilters = true;
		const folder = filters.folder;
		const folderFiles = files.filter((file) => matchesFolder(file, folder));
		includedFiles.push(...folderFiles);
	}

	// Tag filter
	if (filters.tags && filters.tags.length > 0) {
		hasInclusionFilters = true;
		const tags = filters.tags;
		const tagFiles = files.filter((file) =>
			matchesTags(file, tags, metadataCache)
		);

		if (filters.folder) {
			// If we already have folder filtering, intersect the results
			includedFiles = includedFiles.filter((file) => tagFiles.includes(file));
		} else {
			includedFiles.push(...tagFiles);
		}
	}

	// If no inclusion filters were specified, include all files
	return hasInclusionFilters ? includedFiles : files;
}

function applyExclusionFilters(
	files: TFile[],
	filters: FieldFilter,
	metadataCache: (file: TFile) => CachedMetadata | null
): TFile[] {
	return files.filter((file) => {
		// Exclude by folder
		if (filters.excludeFolders && filters.excludeFolders.length > 0) {
			if (
				filters.excludeFolders.some((folder) => matchesFolder(file, folder))
			) {
				return false;
			}
		}

		// Exclude by tag
		if (filters.excludeTags && filters.excludeTags.length > 0) {
			if (matchesTags(file, filters.excludeTags, metadataCache)) {
				return false;
			}
		}

		// Exclude by specific file
		if (filters.excludeFiles && filters.excludeFiles.length > 0) {
			if (
				filters.excludeFiles.some((excludeFile) =>
					matchesFile(file, excludeFile)
				)
			) {
				return false;
			}
		}

		return true;
	});
}

function matchesFolder(file: TFile, folder: string): boolean {
	// Normalize paths for comparison
	const normalizedFolder = normalizePath(folder);
	const normalizedFilePath = normalizePath(file.path);

	// Check if file is in the specified folder or its subfolders
	return (
		normalizedFilePath.startsWith(`${normalizedFolder}/`) ||
		normalizedFilePath.substring(0, normalizedFilePath.lastIndexOf("/")) ===
			normalizedFolder
	);
}

function matchesTags(
	file: TFile,
	requiredTags: string[],
	metadataCache: (file: TFile) => CachedMetadata | null
): boolean {
	const metadata = metadataCache(file);
	if (!metadata) {
		return false;
	}

	// Get all tags from the file (both frontmatter and inline)
	const fileTags = getAllTags(metadata);

	// Check if file has any of the required tags (OR logic for inclusion, AND logic for exclusion)
	return requiredTags.some((requiredTag) =>
		fileTags.some(
			(fileTag) =>
				fileTag === requiredTag || fileTag.startsWith(`${requiredTag}/`)
		)
	);
}

function matchesFile(file: TFile, targetFile: string): boolean {
	// Match by exact name or path
	return file.name === targetFile || file.path === targetFile;
}

function getAllTags(metadata: CachedMetadata): string[] {
	const tags: string[] = [];

	// Get tags from frontmatter
	if (metadata.frontmatter?.tags) {
		const frontmatterTags = Array.isArray(metadata.frontmatter.tags)
			? metadata.frontmatter.tags
			: [metadata.frontmatter.tags];

		tags.push(
			...frontmatterTags.map((tag) =>
				typeof tag === "string" ? tag : String(tag)
			)
		);
	}

	if (metadata.frontmatter?.tag) {
		const frontmatterTag = Array.isArray(metadata.frontmatter.tag)
			? metadata.frontmatter.tag
			: [metadata.frontmatter.tag];

		tags.push(
			...frontmatterTag.map((tag) =>
				typeof tag === "string" ? tag : String(tag)
			)
		);
	}

	// Get inline tags
	if (metadata.tags) {
		tags.push(
			...metadata.tags.map((tag) =>
				tag.tag.startsWith("#") ? tag.tag.substring(1) : tag.tag
			)
		);
	}

	return tags;
}

function normalizePath(path: string): string {
	// Remove leading/trailing slashes and normalize
	return path.replace(/^\/+|\/+$/g, "");
}

export const EnhancedFieldSuggestionFileFilter = {
	filterFiles,
};
