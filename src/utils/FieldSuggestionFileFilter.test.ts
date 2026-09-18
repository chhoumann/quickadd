import { filterFixture, fieldTag as makeTag } from "../../tests/helpers/suggesters/fieldFiles";
import { describe, it, expect, beforeEach } from "vitest";
import type { FieldFilter } from "./FieldSuggestionParser";
import { FieldSuggestionFileFilter } from "./FieldSuggestionFileFilter";
import type { TFile, CachedMetadata } from "obsidian";

describe("FieldSuggestionFileFilter", () => {
	let mockFiles: TFile[];
	let mockMetadataCache: (file: TFile) => CachedMetadata|null;

	beforeEach(() => {
		// Create mock files
		mockFiles=[
			{ path: "daily/2024-01-01.md" } as TFile,
			{ path: "daily/2024-01-02.md" } as TFile,
			{ path: "projects/project1.md" } as TFile,
			{ path: "projects/work/task1.md" } as TFile,
			{ path: "notes/random.md" } as TFile,
		];

		// Create mock metadata cache
		const metadataMap=new Map<string, CachedMetadata>([
			[
				"daily/2024-01-01.md",
				{
					tags: [makeTag("#daily"), makeTag("#work")],
				} as CachedMetadata,
			],
			[
				"daily/2024-01-02.md",
				{
					tags: [makeTag("#daily"), makeTag("#personal")],
				} as CachedMetadata,
			],
			[
				"projects/project1.md",
				{
					tags: [makeTag("#project"), makeTag("#work")],
				} as CachedMetadata,
			],
			[
				"projects/work/task1.md",
				{
					tags: [makeTag("#work"), makeTag("#task")],
				} as CachedMetadata,
			],
			["notes/random.md", {} as CachedMetadata],
		]);

		mockMetadataCache=(file: TFile) =>
			metadataMap.get(file.path)||null;
	});

	describe("filterFiles", () => {
		it("should return all files when no filters are provided", () => {
			const result=FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{},
				mockMetadataCache,
			);
			expect(result).toEqual(mockFiles);
		});

		it("should filter files by folder", () => {
			const result=FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ folder: "daily" },
				mockMetadataCache,
			);
			expect(result).toHaveLength(2);
			expect(result.map((f) => f.path)).toEqual([
				"daily/2024-01-01.md",
				"daily/2024-01-02.md",
			]);
		});

		it("should filter files by multiple folders (OR logic)", () => {
			const result=FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ folder: "daily", folders: ["daily", "projects"] },
				mockMetadataCache,
			);
			expect(result.map((f) => f.path)).toEqual([
				"daily/2024-01-01.md",
				"daily/2024-01-02.md",
				"projects/project1.md",
				"projects/work/task1.md",
			]);
		});

		it("should filter files by nested folder", () => {
			const result=FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ folder: "projects/work" },
				mockMetadataCache,
			);
			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("projects/work/task1.md");
		});

		it("should filter files by tag", () => {
			const result=FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ tags: ["work"] },
				mockMetadataCache,
			);
			expect(result).toHaveLength(3);
			expect(result.map((f) => f.path)).toContain("daily/2024-01-01.md");
			expect(result.map((f) => f.path)).toContain("projects/project1.md");
			expect(result.map((f) => f.path)).toContain(
				"projects/work/task1.md",
			);
		});

		it("should filter files by multiple tags (AND logic)", () => {
			const result=FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ tags: ["work", "daily"] },
				mockMetadataCache,
			);
			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("daily/2024-01-01.md");
		});

		it("should filter files by folder and tags", () => {
			const result=FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ folder: "daily", tags: ["personal"] },
				mockMetadataCache,
			);
			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("daily/2024-01-02.md");
		});

		it("should handle files without tags", () => {
			const result=FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ tags: ["work"] },
				mockMetadataCache,
			);
			expect(result.map((f) => f.path)).not.toContain("notes/random.md");
		});

		it("should handle folder paths with leading/trailing slashes", () => {
			const result=FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ folder: "/daily/" },
				mockMetadataCache,
			);
			expect(result).toHaveLength(2);
			expect(result.map((f) => f.path)).toEqual([
				"daily/2024-01-01.md",
				"daily/2024-01-02.md",
			]);
		});

		it("should return empty array when no files match", () => {
			const result=FieldSuggestionFileFilter.filterFiles(
				mockFiles,
				{ folder: "nonexistent" },
				mockMetadataCache,
			);
			expect(result).toHaveLength(0);
		});

		it.each<{ name: string; metadata: Parameters<typeof filterFixture>[0]; filters: FieldFilter }>([
			{
				name: "should filter files by frontmatter tags (string)",
				metadata: {
					"note1.md": { frontmatter: { tags: "Test" }, },
					"note2.md": { frontmatter: { tags: "Other" }, },
				},
				filters: { tags: ["Test"] },
			},
			{
				name: "should split comma-separated scalar frontmatter tags",
				metadata: {
					"note1.md": { frontmatter: { tags: "Test, Work" }, },
					"note2.md": { frontmatter: { tags: "Test" }, },
				},
				filters: { tags: ["Test", "Work"] },
			},
			{
				name: "should split whitespace-separated scalar frontmatter tags",
				metadata: {
					"note1.md": { frontmatter: { tags: "#Test Work" }, },
					"note2.md": { frontmatter: { tags: "Test" }, },
				},
				filters: { tags: ["Test", "Work"] },
			},
			{
				name: "should split scalar singular frontmatter tag values",
				metadata: {
					"note1.md": { frontmatter: { tag: "#Test, Work" }, },
					"note2.md": { frontmatter: { tag: "Test" }, },
				},
				filters: { tags: ["Test", "Work"] },
			},
			{
				name: "should filter files by frontmatter tags (array)",
				metadata: {
					"note1.md": { frontmatter: { tags: ["Test", "Work"] }, },
					"note2.md": { frontmatter: { tags: ["Other"] }, },
				},
				filters: { tags: ["Test"] },
			},
			{
				name: "should filter files by frontmatter tags with leading # in frontmatter",
				metadata: {
					"note1.md": { frontmatter: { tags: ["#Test"] }, },
				},
				filters: { tags: ["Test"] },
			},
			{
				name: "should filter files by frontmatter tags with leading # in filter",
				metadata: {
					"note1.md": { frontmatter: { tags: ["Test"] }, },
				},
				filters: { tags: ["#Test"] },
			},
			{
				name: "should filter files by frontmatter tag (singular field)",
				metadata: {
					"note1.md": { frontmatter: { tag: "Test" }, },
					"note2.md": { frontmatter: { tag: "Other" }, },
				},
				filters: { tags: ["Test"] },
			},
			{
				name: "should filter files by multiple frontmatter tags (AND logic)",
				metadata: {
					"note1.md": { frontmatter: { tags: ["Test", "Work"] }, },
					"note2.md": { frontmatter: { tags: ["Test"] }, },
					"note3.md": { frontmatter: { tags: ["Work"] }, },
				},
				filters: { tags: ["Test", "Work"] },
			},
			{
				name: "should filter files by mixed frontmatter and inline tags",
				metadata: {
					"note1.md": { frontmatter: { tags: ["Test"] }, tags: [makeTag("#work")], },
					"note2.md": { frontmatter: { tags: ["Test"] }, },
				},
				filters: { tags: ["Test", "work"] },
			},
			{
				name: "should handle inline field with value outside frontmatter",
				metadata: {
					"note1.md": { frontmatter: { tags: ["Test"] }, },
				},
				filters: { tags: ["Test"] },
			},
		])("$name", ({ metadata, filters }) => {
			const { files, getMetadata }=filterFixture(metadata);
			const result=FieldSuggestionFileFilter.filterFiles(files, filters, getMetadata);
			expect(result).toHaveLength(1);
			expect(result[0].path).toBe("note1.md");
		});













	});
});
