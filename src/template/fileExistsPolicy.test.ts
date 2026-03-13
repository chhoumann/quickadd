import { describe, expect, it, vi } from "vitest";
import {
	fileExistsBehaviorCategoryOptions,
	getBehaviorCategory,
	getDefaultBehaviorForCategory,
	getFileExistsMode,
	getModesForCategory,
	getPromptModes,
	mapLegacyFileExistsModeToId,
	resolveDuplicateSuffixCollisionPath,
	resolveIncrementedCollisionPath,
} from "./fileExistsPolicy";

describe("fileExistsPolicy registry", () => {
	it("exposes stable behavior categories", () => {
		expect(fileExistsBehaviorCategoryOptions.map((option) => option.id)).toEqual([
			"prompt",
			"update",
			"create",
			"keep",
		]);
	});

	it("groups modes by category", () => {
		expect(getModesForCategory("update").map((mode) => mode.id)).toEqual([
			"appendBottom",
			"appendTop",
			"overwrite",
		]);
		expect(getModesForCategory("create").map((mode) => mode.id)).toEqual([
			"increment",
			"duplicateSuffix",
		]);
		expect(getModesForCategory("keep").map((mode) => mode.id)).toEqual([
			"doNothing",
		]);
	});

	it("derives behavior category from behavior state", () => {
		expect(getBehaviorCategory({ kind: "prompt" })).toBe("prompt");
		expect(
			getBehaviorCategory({ kind: "apply", mode: "appendBottom" }),
		).toBe("update");
		expect(getBehaviorCategory({ kind: "apply", mode: "increment" })).toBe(
			"create",
		);
		expect(getBehaviorCategory({ kind: "apply", mode: "doNothing" })).toBe(
			"keep",
		);
	});

	it("returns category defaults and preserves modes already in-category", () => {
		expect(getDefaultBehaviorForCategory("prompt")).toEqual({ kind: "prompt" });
		expect(getDefaultBehaviorForCategory("update")).toEqual({
			kind: "apply",
			mode: "appendBottom",
		});
		expect(getDefaultBehaviorForCategory("create")).toEqual({
			kind: "apply",
			mode: "duplicateSuffix",
		});
		expect(
			getDefaultBehaviorForCategory("create", {
				kind: "apply",
				mode: "increment",
			}),
		).toEqual({
			kind: "apply",
			mode: "increment",
		});
	});

	it("exposes prompt modes and legacy mapping for all supported modes", () => {
		expect(getPromptModes().map((mode) => mode.id)).toEqual([
			"appendBottom",
			"appendTop",
			"overwrite",
			"increment",
			"duplicateSuffix",
			"doNothing",
		]);
		expect(getFileExistsMode("duplicateSuffix").description).toContain(
			"duplicate marker",
		);
		expect(
			mapLegacyFileExistsModeToId("Append to the bottom of the file"),
		).toBe("appendBottom");
		expect(mapLegacyFileExistsModeToId("Append duplicate suffix")).toBe(
			"duplicateSuffix",
		);
		expect(mapLegacyFileExistsModeToId("Nothing")).toBe("doNothing");
	});
});

describe("fileExistsPolicy collision naming", () => {
	it("appends 1 before .md when no number exists", async () => {
		const exists = vi
			.fn<(path: string) => Promise<boolean>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(resolveIncrementedCollisionPath("Note.md", exists)).resolves.toBe(
			"Note1.md",
		);
	});

	it("preserves zero padding for markdown files", async () => {
		const exists = vi
			.fn<(path: string) => Promise<boolean>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(
			resolveIncrementedCollisionPath("Note009.md", exists),
		).resolves.toBe("Note010.md");
	});

	it("preserves zero padding for identifier-like markdown files", async () => {
		const exists = vi
			.fn<(path: string) => Promise<boolean>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(
			resolveIncrementedCollisionPath("tt0780504.md", exists),
		).resolves.toBe("tt0780505.md");
	});

	it("preserves zero padding for .canvas files", async () => {
		const exists = vi
			.fn<(path: string) => Promise<boolean>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(
			resolveIncrementedCollisionPath("tt009.canvas", exists),
		).resolves.toBe("tt010.canvas");
	});

	it("preserves zero padding for .base files", async () => {
		const exists = vi
			.fn<(path: string) => Promise<boolean>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(resolveIncrementedCollisionPath("tt009.base", exists)).resolves.toBe(
			"tt010.base",
		);
	});

	it("recurses incrementing until an available file name is found", async () => {
		const exists = vi.fn(async (path: string) => {
			return path === "Note.md" || path === "Note1.md";
		});

		await expect(resolveIncrementedCollisionPath("Note.md", exists)).resolves.toBe(
			"Note2.md",
		);
	});

	it("passes through unchanged when there is no collision", async () => {
		const exists = vi.fn(async () => false);

		await expect(resolveIncrementedCollisionPath("Note.md", exists)).resolves.toBe(
			"Note.md",
		);
		await expect(
			resolveDuplicateSuffixCollisionPath("Note.md", exists),
		).resolves.toBe("Note.md");
	});

	it("appends a duplicate suffix to markdown files", async () => {
		const exists = vi
			.fn<(path: string) => Promise<boolean>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(
			resolveDuplicateSuffixCollisionPath("Note.md", exists),
		).resolves.toBe("Note (1).md");
	});

	it("increments an existing duplicate suffix", async () => {
		const exists = vi
			.fn<(path: string) => Promise<boolean>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(
			resolveDuplicateSuffixCollisionPath("Note (1).md", exists),
		).resolves.toBe("Note (2).md");
	});

	it("preserves trailing digits when adding a duplicate suffix", async () => {
		const exists = vi
			.fn<(path: string) => Promise<boolean>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(
			resolveDuplicateSuffixCollisionPath("Note1.md", exists),
		).resolves.toBe("Note1 (1).md");
	});

	it("adds a duplicate suffix for identifier-like markdown files", async () => {
		const exists = vi
			.fn<(path: string) => Promise<boolean>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);

		await expect(
			resolveDuplicateSuffixCollisionPath("tt0780504.md", exists),
		).resolves.toBe("tt0780504 (1).md");
	});
});
