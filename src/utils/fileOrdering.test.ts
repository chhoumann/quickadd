import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { orderFilesForPicker, type PickerOrderingDeps } from "./fileOrdering";

const file = (path: string, basename?: string): TFile =>
	({
		path,
		basename: basename ?? path.split("/").pop()?.replace(/\.md$/, "") ?? path,
	}) as TFile;

const paths = (files: TFile[]): string[] => files.map((f) => f.path);

describe("orderFilesForPicker", () => {
	it("falls back to a stable alphabetical order with no deps", () => {
		const files = [file("Charlie.md"), file("alpha.md"), file("Bravo.md")];
		expect(paths(orderFilesForPicker(files))).toEqual([
			"alpha.md",
			"Bravo.md",
			"Charlie.md",
		]);
	});

	it("sorts session-recency (openedAt) newest-first, ahead of non-recent files", () => {
		const files = [file("a.md"), file("b.md"), file("c.md")];
		const openedAt: Record<string, number> = { "b.md": 100, "c.md": 200 };
		const deps: PickerOrderingDeps = {
			openedAtOf: (p) => openedAt[p],
		};
		// c (200) and b (100) are recent (newest first); a has no openedAt -> tail.
		expect(paths(orderFilesForPicker(files, deps))).toEqual([
			"c.md",
			"b.md",
			"a.md",
		]);
	});

	it("uses getLastOpenFiles rank as the cross-session baseline when openedAt is absent", () => {
		const files = [file("a.md"), file("b.md"), file("c.md")];
		const recent = ["c.md", "a.md"]; // c most recent, then a, b not recent
		const deps: PickerOrderingDeps = {
			recentRankOf: (p) => {
				const i = recent.indexOf(p);
				return i === -1 ? undefined : i;
			},
		};
		expect(paths(orderFilesForPicker(files, deps))).toEqual([
			"c.md",
			"a.md",
			"b.md",
		]);
	});

	it("prefers session recency over cross-session recents", () => {
		const files = [file("opened.md"), file("recent.md")];
		const deps: PickerOrderingDeps = {
			openedAtOf: (p) => (p === "opened.md" ? 500 : undefined),
			recentRankOf: (p) => (p === "recent.md" ? 0 : undefined),
		};
		// opened.md wins on the session-recency tier even though recent.md is rank 0.
		expect(paths(orderFilesForPicker(files, deps))).toEqual([
			"opened.md",
			"recent.md",
		]);
	});

	it("sinks excluded files to the bottom but keeps them present", () => {
		const files = [file("Excluded.md"), file("alpha.md"), file("beta.md")];
		const deps: PickerOrderingDeps = {
			isExcluded: (p) => p === "Excluded.md",
		};
		expect(paths(orderFilesForPicker(files, deps))).toEqual([
			"alpha.md",
			"beta.md",
			"Excluded.md",
		]);
	});

	it("keeps an excluded recent file below non-excluded files", () => {
		const files = [file("normal.md"), file("excludedRecent.md")];
		const deps: PickerOrderingDeps = {
			openedAtOf: (p) => (p === "excludedRecent.md" ? 999 : undefined),
			isExcluded: (p) => p === "excludedRecent.md",
		};
		expect(paths(orderFilesForPicker(files, deps))).toEqual([
			"normal.md",
			"excludedRecent.md",
		]);
	});

	it("does not mutate the input array", () => {
		const files = [file("b.md"), file("a.md")];
		const snapshot = paths(files);
		orderFilesForPicker(files);
		expect(paths(files)).toEqual(snapshot);
	});

	it("tolerates files lacking a basename by falling back to the path", () => {
		const partial = [{ path: "z/Note.md" }, { path: "a/Note.md" }] as TFile[];
		// localeCompare on the full path: "a/Note.md" < "z/Note.md".
		expect(paths(orderFilesForPicker(partial))).toEqual([
			"a/Note.md",
			"z/Note.md",
		]);
	});
});
