import { describe, it, expect, beforeEach } from "vitest";
import { FieldSuggestionFileFilter } from "./FieldSuggestionFileFilter";
import type { TFile, CachedMetadata } from "obsidian";

describe("FieldSuggestionFileFilter", () => {
	let mockFiles: TFile[];
	let mockMetadataCache: (file: TFile) => CachedMetadata | null;

	beforeEach(() => {
		// Create mock files
		mockFiles = [
			{ path: "daily/2024-01-01.md" } as TFile,
			{ path: "daily/2024-01-02.md" } as TFile,
			{ path: "projects/project1.md" } as TFile,
			{ path: "projects/work/task1.md" } as TFile,
			{ path: "notes/random.md" } as TFile,
		];

		// Create mock metadata cache
		const metadataMap = new Map<string, CachedMetadata>([
			[
				"daily/2024-01-01.md",
				{
					tags: [{ tag: "#daily" }, { tag: "#work" }],
				} as CachedMetadata,
			],
			[
				"daily/2024-01-02.md",
				{
					tags: [{ tag: "#daily" }, { tag: "#personal" }],
				} as CachedMetadata,
			],
			[
				"projects/project1.md",
				{
					tags: [{ tag: "#project" }, { tag: "#work" }],
				} as CachedMetadata,
			],
			[
				"projects/work/task1.md",
				{
					tags: [{ tag: "#work" }, { tag: "#task" }],
				} as CachedMetadata,
			],
			["notes/random.md", {} as CachedMetadata],
		]);

		mockMetadataCache = (file: TFile) => metadataMap.get(file.path) || null;
	});

	describe("filterFiles", () => {
		it("should return all files when no filters are provided", () => {
			const result = FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{},
				mockMetadataCache
			);
			expect(result).toEqual(mockFiles);
		});

		it("should filter files by folder", () => {
			const result = FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ folder: "daily" },
				mockMetadataCache
			);
			expect(result).toHaveLength(2);
			expect(result.map((f) => f.path)).toEqual([
				"daily/2024-01-01.md",
				"daily/2024-01-02.md",
			]);
		});

		it("should filter files by nested folder", () => {
			const result = FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ folder: "projects/work" },
				mockMetadataCache
			);
			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("projects/work/task1.md");
		});

		it("should filter files by tag", () => {
			const result = FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ tags: ["work"] },
				mockMetadataCache
			);
			expect(result).toHaveLength(3);
			expect(result.map((f) => f.path)).toContain("daily/2024-01-01.md");
			expect(result.map((f) => f.path)).toContain("projects/project1.md");
			expect(result.map((f) => f.path)).toContain("projects/work/task1.md");
		});

		it("should filter files by multiple tags (AND logic)", () => {
			const result = FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ tags: ["work", "daily"] },
				mockMetadataCache
			);
			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("daily/2024-01-01.md");
		});

		it("should filter files by folder and tags", () => {
			const result = FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ folder: "daily", tags: ["personal"] },
				mockMetadataCache
			);
			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("daily/2024-01-02.md");
		});

		it("should handle files without tags", () => {
			const result = FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ tags: ["work"] },
				mockMetadataCache
			);
			expect(result.map((f) => f.path)).not.toContain("notes/random.md");
		});

		it("should handle folder paths with leading/trailing slashes", () => {
			const result = FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ folder: "/daily/" },
				mockMetadataCache
			);
			expect(result).toHaveLength(2);
			expect(result.map((f) => f.path)).toEqual([
				"daily/2024-01-01.md",
				"daily/2024-01-02.md",
			]);
		});

		it("should return empty array when no files match", () => {
			const result = FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ folder: "nonexistent" },
				mockMetadataCache
			);
			expect(result).toHaveLength(0);
		});
	});
});
