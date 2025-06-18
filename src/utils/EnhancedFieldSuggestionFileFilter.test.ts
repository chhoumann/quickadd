import { describe, it, expect } from "vitest";
import type { CachedMetadata, TFile } from "obsidian";
import { EnhancedFieldSuggestionFileFilter } from "./EnhancedFieldSuggestionFileFilter";
import type { FieldFilter } from "./FieldSuggestionParser";

// Mock TFile
const createMockFile = (path: string): TFile => {
	return {
		path,
		name: path.split("/").pop() || "",
		basename: path.split("/").pop()?.split(".")[0] || "",
		extension: path.split(".").pop() || "",
		stat: { ctime: 0, mtime: 0, size: 0 },
		vault: {} as any,
		parent: null,
	} as TFile;
};

// Mock CachedMetadata
const createMockMetadata = (tags?: string[], frontmatterTags?: string[]): CachedMetadata => {
	const metadata: any = {};
	
	if (tags) {
		metadata.tags = tags.map(tag => ({ tag, position: { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } } }));
	}
	
	if (frontmatterTags) {
		metadata.frontmatter = { tags: frontmatterTags };
	}
	
	return metadata as CachedMetadata;
};

describe("EnhancedFieldSuggestionFileFilter", () => {
	describe("filterFiles", () => {
		const mockFiles = [
			createMockFile("folder1/file1.md"),
			createMockFile("folder1/subfolder/file2.md"),
			createMockFile("folder2/file3.md"),
			createMockFile("folder2/file4.md"),
			createMockFile("archive/old-file.md"),
			createMockFile("root-file.md"),
		];

		const mockMetadataCache = (file: TFile): CachedMetadata | null => {
			const metadataMap: Record<string, CachedMetadata | null> = {
				"folder1/file1.md": createMockMetadata(["#project", "#todo"]),
				"folder1/subfolder/file2.md": createMockMetadata(["#project"], ["important"]),
				"folder2/file3.md": createMockMetadata(["#done"], ["archive"]),
				"folder2/file4.md": createMockMetadata(["#todo", "#deprecated"]),
				"archive/old-file.md": createMockMetadata(["#archive", "#old"]),
				"root-file.md": createMockMetadata(["#todo"]),
			};
			return metadataMap[file.path] || null;
		};

		it("should return all files when no filters are provided", () => {
			const filters: FieldFilter = {};
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(6);
		});

		it("should filter by folder inclusion", () => {
			const filters: FieldFilter = { folder: "folder1" };
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(2);
			expect(result.map(f => f.path)).toEqual([
				"folder1/file1.md",
				"folder1/subfolder/file2.md",
			]);
		});

		it("should filter by tag inclusion", () => {
			const filters: FieldFilter = { tags: ["todo"] };
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(3);
			expect(result.map(f => f.path)).toContain("folder1/file1.md");
			expect(result.map(f => f.path)).toContain("folder2/file4.md");
			expect(result.map(f => f.path)).toContain("root-file.md");
		});

		it("should exclude folders", () => {
			const filters: FieldFilter = { excludeFolders: ["archive"] };
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(5);
			expect(result.map(f => f.path)).not.toContain("archive/old-file.md");
		});

		it("should exclude multiple folders", () => {
			const filters: FieldFilter = { excludeFolders: ["archive", "folder2"] };
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(3);
			expect(result.map(f => f.path)).toEqual([
				"folder1/file1.md",
				"folder1/subfolder/file2.md",
				"root-file.md",
			]);
		});

		it("should exclude by tags", () => {
			const filters: FieldFilter = { excludeTags: ["deprecated"] };
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(5);
			expect(result.map(f => f.path)).not.toContain("folder2/file4.md");
		});

		it("should exclude by multiple tags (OR logic)", () => {
			const filters: FieldFilter = { excludeTags: ["deprecated", "archive"] };
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(3);
			expect(result.map(f => f.path)).not.toContain("folder2/file4.md");
			expect(result.map(f => f.path)).not.toContain("archive/old-file.md");
			expect(result.map(f => f.path)).not.toContain("folder2/file3.md"); // has archive in frontmatter
		});

		it("should exclude specific files", () => {
			const filters: FieldFilter = { excludeFiles: ["folder1/file1.md", "root-file.md"] };
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(4);
			expect(result.map(f => f.path)).not.toContain("folder1/file1.md");
			expect(result.map(f => f.path)).not.toContain("root-file.md");
		});

		it("should combine inclusion and exclusion filters", () => {
			const filters: FieldFilter = {
				folder: "folder1",
				excludeTags: ["todo"],
			};
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("folder1/subfolder/file2.md");
		});

		it("should handle complex filter combinations", () => {
			const filters: FieldFilter = {
				tags: ["todo"],
				excludeFolders: ["archive"],
				excludeTags: ["deprecated"],
			};
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(2);
			expect(result.map(f => f.path)).toContain("folder1/file1.md");
			expect(result.map(f => f.path)).toContain("root-file.md");
		});

		it("should handle files without metadata", () => {
			const customMetadataCache = (file: TFile): CachedMetadata | null => {
				if (file.path === "folder1/file1.md") return null;
				return mockMetadataCache(file);
			};

			const filters: FieldFilter = { tags: ["todo"] };
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				customMetadataCache,
			);
			expect(result).toHaveLength(2);
			expect(result.map(f => f.path)).not.toContain("folder1/file1.md");
		});

		it("should handle tags with # prefix", () => {
			// Note: The parser should normalize tags by removing the # prefix
			// So "#todo" in the filter becomes "todo" internally
			const filters: FieldFilter = { tags: ["todo"] };
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(3);
			expect(result.map(f => f.path)).toContain("folder1/file1.md");
			expect(result.map(f => f.path)).toContain("folder2/file4.md");
			expect(result.map(f => f.path)).toContain("root-file.md");
		});

		it("should handle folder paths with slashes", () => {
			const filters: FieldFilter = { 
				folder: "/folder1/",
				excludeFolders: ["/archive/"],
			};
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(2);
			expect(result.map(f => f.path)).toContain("folder1/file1.md");
			expect(result.map(f => f.path)).toContain("folder1/subfolder/file2.md");
		});

		it("should handle frontmatter tags for inclusion", () => {
			const filters: FieldFilter = { tags: ["important"] };
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("folder1/subfolder/file2.md");
		});

		it("should handle frontmatter tags for exclusion", () => {
			const filters: FieldFilter = { excludeTags: ["archive"] };
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(4);
			expect(result.map(f => f.path)).not.toContain("folder2/file3.md");
			expect(result.map(f => f.path)).not.toContain("archive/old-file.md");
		});

		it("should return empty array when all files are filtered out", () => {
			const filters: FieldFilter = {
				folder: "nonexistent",
			};
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(0);
		});

		it("should handle empty exclusion arrays", () => {
			const filters: FieldFilter = {
				excludeFolders: [],
				excludeTags: [],
				excludeFiles: [],
			};
			const result = EnhancedFieldSuggestionFileFilter.filterFiles(
				mockFiles,
				filters,
				mockMetadataCache,
			);
			expect(result).toHaveLength(6);
		});
	});
});