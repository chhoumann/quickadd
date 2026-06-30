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

	it("returns null for unknown legacy modes", () => {
		expect(mapLegacyFileExistsModeToId("")).toBeNull();
		expect(mapLegacyFileExistsModeToId("not a real mode")).toBeNull();
		expect(mapLegacyFileExistsModeToId(123)).toBeNull();
		expect(mapLegacyFileExistsModeToId(undefined)).toBeNull();
	});

	it("returns null for prototype magic keys (no inherited members)", () => {
		// A hand-edited data.json or imported package could set `fileExistsMode`
		// to a JS magic key. A plain-object lookup would resolve the inherited
		// member (truthy), defeating the `?? null` fallback and later throwing
		// "Unknown file exists mode" at template-run time.
		// Every key here resolves to an inherited member pre-fix (this lookup is
		// not lowercased, so the camelCase members match too).
		for (const key of [
			"__proto__",
			"constructor",
			"toString",
			"valueOf",
			"hasOwnProperty",
			"isPrototypeOf",
		]) {
			expect(mapLegacyFileExistsModeToId(key)).toBeNull();
		}
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

describe("fileExistsPolicy collision naming terminates on large trailing numbers", () => {
	// 2^53 (Number.MAX_SAFE_INTEGER + 1): the IEEE-754 ceiling where the old
	// `parseInt(n, 10) + 1` arithmetic became a no-op. The recursive resolvers then
	// computed a "next" path identical to the current one, so `exists` stayed true
	// and they spun forever. A filename like `Foo9007199254740992` is only 19 chars
	// and trivially constructible from a {{VALUE}}/CLI/URI-derived target, and a
	// synced vault can already contain such a note - so this was reachable.
	const TWO_POW_53 = "9007199254740992";

	// Returns false for any path not in `existing`, and throws if probed more than
	// `cap` times so a regression (the old infinite loop) fails loudly instead of
	// hanging the whole suite.
	const boundedExists = (existing: Iterable<string>, cap = 1000) => {
		const present = new Set(existing);
		let calls = 0;
		return vi.fn(async (path: string) => {
			if (++calls > cap) {
				throw new Error(
					`collision resolver did not terminate: ${calls} exists() probes`,
				);
			}
			return present.has(path);
		});
	};

	it("increments past 2^53 instead of looping forever on an identical path", async () => {
		const exists = boundedExists([`Note${TWO_POW_53}.md`]);

		await expect(
			resolveIncrementedCollisionPath(`Note${TWO_POW_53}.md`, exists),
		).resolves.toBe("Note9007199254740993.md");
		expect(exists.mock.calls.length).toBeLessThanOrEqual(2);
	});

	it("increments a duplicate suffix past 2^53 instead of looping forever", async () => {
		const exists = boundedExists([`Note (${TWO_POW_53}).md`]);

		await expect(
			resolveDuplicateSuffixCollisionPath(`Note (${TWO_POW_53}).md`, exists),
		).resolves.toBe("Note (9007199254740993).md");
		expect(exists.mock.calls.length).toBeLessThanOrEqual(2);
	});

	it("walks a chain of >=2^53 collisions to the first free name", async () => {
		const exists = boundedExists([
			"Note9007199254740992.md",
			"Note9007199254740993.md",
			"Note9007199254740994.md",
		]);

		await expect(
			resolveIncrementedCollisionPath("Note9007199254740992.md", exists),
		).resolves.toBe("Note9007199254740995.md");
	});

	it("grows the width when a fully-padded number rolls over (999 -> 1000)", async () => {
		const exists = boundedExists(["Note999.md"]);

		await expect(
			resolveIncrementedCollisionPath("Note999.md", exists),
		).resolves.toBe("Note1000.md");
	});
});
