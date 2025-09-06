import { describe, it, expect } from "vitest";
import { PathNormalizer } from "./pathNormalizer";

describe("PathNormalizer", () => {
	describe("normalize", () => {
		it("should normalize paths consistently", () => {
			expect(PathNormalizer.normalize("Daily Notes")).toBe("Daily Notes");
			expect(PathNormalizer.normalize("Daily Notes/")).toBe("Daily Notes");
			expect(PathNormalizer.normalize("Daily Notes//")).toBe("Daily Notes");
		});

		it("should handle Windows-style backslashes", () => {
			expect(PathNormalizer.normalize("Daily Notes\\subfolder")).toBe("Daily Notes/subfolder");
			expect(PathNormalizer.normalize("Daily Notes\\\\subfolder")).toBe("Daily Notes/subfolder");
			expect(PathNormalizer.normalize("Daily Notes\\subfolder\\")).toBe("Daily Notes/subfolder");
		});

		it("should handle mixed slashes", () => {
			expect(PathNormalizer.normalize("Daily Notes\\subfolder/file.md")).toBe("Daily Notes/subfolder/file.md");
			expect(PathNormalizer.normalize("Daily Notes/subfolder\\file.md")).toBe("Daily Notes/subfolder/file.md");
		});

		it("should handle empty and null paths", () => {
			expect(PathNormalizer.normalize("")).toBe("");
			expect(PathNormalizer.normalize(null as any)).toBe("");
			expect(PathNormalizer.normalize(undefined as any)).toBe("");
		});
	});

	describe("isValidPath", () => {
		it("should identify valid paths", () => {
			expect(PathNormalizer.isValidPath("Daily Notes")).toBe(true);
			expect(PathNormalizer.isValidPath("folder/subfolder")).toBe(true);
		});

		it("should identify invalid paths", () => {
			expect(PathNormalizer.isValidPath("")).toBe(false);
			expect(PathNormalizer.isValidPath("   ")).toBe(false);
			expect(PathNormalizer.isValidPath(null as any)).toBe(false);
		});
	});

	describe("isFilePath", () => {
		it("should identify file paths", () => {
			expect(PathNormalizer.isFilePath("document.md")).toBe(true);
			expect(PathNormalizer.isFilePath("folder/document.md")).toBe(true);
			expect(PathNormalizer.isFilePath("script.js")).toBe(true);
		});

		it("should identify non-file paths", () => {
			expect(PathNormalizer.isFilePath("Daily Notes")).toBe(false);
			expect(PathNormalizer.isFilePath("folder/subfolder")).toBe(false);
			expect(PathNormalizer.isFilePath("")).toBe(false);
		});

		it("should handle edge cases", () => {
			expect(PathNormalizer.isFilePath("file.")).toBe(true); // Has dot
			expect(PathNormalizer.isFilePath(".hidden")).toBe(true); // Hidden file
			expect(PathNormalizer.isFilePath("folder/.hidden")).toBe(true); // Hidden file in folder
		});
	});

	describe("isFolderPath", () => {
		it("should identify folder paths", () => {
			expect(PathNormalizer.isFolderPath("Daily Notes")).toBe(true);
			expect(PathNormalizer.isFolderPath("folder/subfolder")).toBe(true);
		});

		it("should identify non-folder paths", () => {
			expect(PathNormalizer.isFolderPath("document.md")).toBe(false);
			expect(PathNormalizer.isFolderPath("folder/document.md")).toBe(false);
			expect(PathNormalizer.isFolderPath("")).toBe(false);
		});
	});

	describe("arePathsEquivalent", () => {
		it("should identify equivalent paths", () => {
			expect(PathNormalizer.arePathsEquivalent("Daily Notes", "Daily Notes")).toBe(true);
			expect(PathNormalizer.arePathsEquivalent("Daily Notes/", "Daily Notes")).toBe(true);
			expect(PathNormalizer.arePathsEquivalent("Daily Notes\\", "Daily Notes/")).toBe(true);
		});

		it("should identify non-equivalent paths", () => {
			expect(PathNormalizer.arePathsEquivalent("Daily Notes", "Journal")).toBe(false);
			expect(PathNormalizer.arePathsEquivalent("Daily Notes", "Daily Notes/subfolder")).toBe(false);
		});
	});

	describe("isSubfolderOf", () => {
		it("should identify subfolders correctly", () => {
			expect(PathNormalizer.isSubfolderOf("Daily Notes/subfolder", "Daily Notes")).toBe(true);
			expect(PathNormalizer.isSubfolderOf("Daily Notes/sub1/sub2", "Daily Notes")).toBe(true);
			expect(PathNormalizer.isSubfolderOf("Daily Notes\\subfolder", "Daily Notes")).toBe(true);
		});

		it("should not identify non-subfolders", () => {
			expect(PathNormalizer.isSubfolderOf("Daily Notes", "Daily Notes")).toBe(false); // Same folder
			expect(PathNormalizer.isSubfolderOf("Journal", "Daily Notes")).toBe(false); // Different folder
			expect(PathNormalizer.isSubfolderOf("Daily NotesExtra", "Daily Notes")).toBe(false); // Similar name but not subfolder
		});

		it("should handle root folder", () => {
			expect(PathNormalizer.isSubfolderOf("Daily Notes", "")).toBe(true);
			expect(PathNormalizer.isSubfolderOf("any/folder", "")).toBe(true);
		});
	});
});