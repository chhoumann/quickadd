import { describe, expect, it } from "vitest";
import { VaultFileService } from "../services/VaultFileService";

describe("VaultFileService path normalization", () => {
	const service = new VaultFileService({} as any);

	it("strips leading slashes from folder and file", () => {
		expect(service.normalizeMarkdownFilePath("/daily", "/note")).toBe(
			"daily/note.md",
		);
	});

	it("strips leading slashes from file-only paths", () => {
		expect(service.normalizeMarkdownFilePath("", "/review/daily")).toBe(
			"review/daily.md",
		);
	});

	it("omits empty folder prefixes and de-duplicates markdown suffixes", () => {
		expect(service.normalizeMarkdownFilePath("", "note.md")).toBe("note.md");
		expect(service.normalizeMarkdownFilePath("/folder", "note.md")).toBe(
			"folder/note.md",
		);
	});
});
