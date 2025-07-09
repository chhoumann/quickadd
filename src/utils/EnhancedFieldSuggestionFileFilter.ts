import type { TFile, CachedMetadata } from "obsidian";
import type { FieldFilter } from "./FieldSuggestionParser";

export class EnhancedFieldSuggestionFileFilter {
	/**
	 * Enhanced file filtering with inclusion and exclusion support
	 */
	static filterFiles(
		files: TFile[],
		filters: FieldFilter,
		metadataCache: (file: TFile) => CachedMetadata | null,
	): TFile[] {
		let filteredFiles = files;

		// Apply inclusion filters first
		filteredFiles = this.applyInclusionFilters(filteredFiles, filters, metadataCache);

		// Apply exclusion filters
		filteredFiles = this.applyExclusionFilters(filteredFiles, filters, metadataCache);

		return filteredFiles;
	}

	private static applyInclusionFilters(
		files: TFile[],
		filters: FieldFilter,
		metadataCache: (file: TFile) => CachedMetadata | null,
	): TFile[] {
		let hasInclusionFilters = false;
		let includedFiles: TFile[] = [];

		// Folder filter
		if (filters.folder) {
			hasInclusionFilters = true;
			const folder = filters.folder;
			const folderFiles = files.filter(file => this.matchesFolder(file, folder));
			includedFiles.push(...folderFiles);
		}

		// Tag filter
		if (filters.tags && filters.tags.length > 0) {
			hasInclusionFilters = true;
			const tags = filters.tags;
			const tagFiles = files.filter(file => 
				this.matchesTags(file, tags, metadataCache)
			);
			
			if (filters.folder) {
				// If we already have folder filtering, intersect the results
				includedFiles = includedFiles.filter(file => tagFiles.includes(file));
			} else {
				includedFiles.push(...tagFiles);
			}
		}

		// If no inclusion filters were specified, include all files
		return hasInclusionFilters ? includedFiles : files;
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
				if (this.matchesTags(file, filters.excludeTags, metadataCache)) {
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
	): boolean {
		const metadata = metadataCache(file);
		if (!metadata) {
			return false;
		}

		// Get all tags from the file (both frontmatter and inline)
		const fileTags = this.getAllTags(metadata);

		// Check if file has any of the required tags (OR logic for inclusion, AND logic for exclusion)
		return requiredTags.some(requiredTag =>
			fileTags.some(fileTag => 
				fileTag === requiredTag || fileTag.startsWith(requiredTag + "/")
			)
		);
	}

	private static matchesFile(file: TFile, targetFile: string): boolean {
		// Match by exact name or path
		return file.name === targetFile || file.path === targetFile;
	}

	private static getAllTags(metadata: CachedMetadata): string[] {
		const tags: string[] = [];

		// Get tags from frontmatter
		if (metadata.frontmatter?.tags) {
			const frontmatterTags = Array.isArray(metadata.frontmatter.tags)
				? metadata.frontmatter.tags
				: [metadata.frontmatter.tags];
			
			tags.push(...frontmatterTags.map(tag => 
				typeof tag === 'string' ? tag : String(tag)
			));
		}

		if (metadata.frontmatter?.tag) {
			const frontmatterTag = Array.isArray(metadata.frontmatter.tag)
				? metadata.frontmatter.tag
				: [metadata.frontmatter.tag];
			
			tags.push(...frontmatterTag.map(tag => 
				typeof tag === 'string' ? tag : String(tag)
			));
		}

		// Get inline tags
		if (metadata.tags) {
			tags.push(...metadata.tags.map(tag => 
				tag.tag.startsWith("#") ? tag.tag.substring(1) : tag.tag
			));
		}

		return tags;
	}

	private static normalizePath(path: string): string {
		// Remove leading/trailing slashes and normalize
		return path.replace(/^\/+|\/+$/g, "");
	}
}
