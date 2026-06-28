import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import {
	frontmatterValueMatches,
	getMarkdownFilesInFolder,
	getMarkdownFilesMatchingFilter,
	getMarkdownFilesWithProperty,
	getMarkdownFilesWithTag,
} from "./vaultQueries";

describe("frontmatterValueMatches", () => {
	it("matches scalar strings case-insensitively and trimmed", () => {
		expect(frontmatterValueMatches("draft", "draft")).toBe(true);
		expect(frontmatterValueMatches("Draft", "draft")).toBe(true);
		expect(frontmatterValueMatches("  draft  ", "draft")).toBe(true);
		expect(frontmatterValueMatches("draft", "note")).toBe(false);
	});

	it("coerces numbers and booleans (including 0 and false)", () => {
		expect(frontmatterValueMatches(1, "1")).toBe(true);
		expect(frontmatterValueMatches(0, "0")).toBe(true);
		expect(frontmatterValueMatches(true, "true")).toBe(true);
		expect(frontmatterValueMatches(false, "false")).toBe(true);
		expect(frontmatterValueMatches(0, "")).toBe(false);
	});

	it("matches any element of an array", () => {
		expect(frontmatterValueMatches(["draft", "idea"], "idea")).toBe(true);
		expect(frontmatterValueMatches(["draft", "idea"], "DRAFT")).toBe(true);
		expect(frontmatterValueMatches([1, 2, 3], "2")).toBe(true);
		expect(frontmatterValueMatches(["draft", "idea"], "log")).toBe(false);
	});

	it("never matches null/undefined (avoids the String(null) === 'null' trap)", () => {
		expect(frontmatterValueMatches(null, "draft")).toBe(false);
		expect(frontmatterValueMatches(undefined, "draft")).toBe(false);
		expect(frontmatterValueMatches(null, "null")).toBe(false);
	});

	it("never equality-matches a nested object", () => {
		expect(frontmatterValueMatches({ a: 1 }, "[object Object]")).toBe(false);
		expect(frontmatterValueMatches([{ a: 1 }], "[object Object]")).toBe(false);
	});
});

type FakeFile = { path: string; basename: string };

function makeApp(
	files: Array<{ path: string; basename: string; frontmatter: Record<string, unknown> | null }>,
): App {
	const fileObjs: FakeFile[] = files.map((f) => ({
		path: f.path,
		basename: f.basename,
	}));
	const cacheByPath = new Map(
		files.map((f) => [f.path, f.frontmatter ? { frontmatter: f.frontmatter } : {}]),
	);
	return {
		vault: {
			getMarkdownFiles: () => fileObjs as unknown as TFile[],
		},
		metadataCache: {
			getFileCache: (file: TFile) =>
				cacheByPath.get((file as unknown as FakeFile).path) ?? null,
		},
	} as unknown as App;
}

describe("getMarkdownFilesWithProperty", () => {
	const app = makeApp([
		{ path: "Draft A.md", basename: "Draft A", frontmatter: { type: "draft" } },
		{ path: "Draft B.md", basename: "Draft B", frontmatter: { Type: "Draft" } },
		{ path: "Note C.md", basename: "Note C", frontmatter: { type: "note" } },
		{ path: "Arr D.md", basename: "Arr D", frontmatter: { type: ["draft", "idea"] } },
		{ path: "Empty E.md", basename: "Empty E", frontmatter: { type: null } },
		{ path: "Sub/Draft F.md", basename: "Draft F", frontmatter: { type: "draft" } },
		{ path: "None G.md", basename: "None G", frontmatter: null },
	]);

	it("matches by value, case-insensitively on key and value, including arrays", () => {
		const paths = getMarkdownFilesWithProperty(app, "type", "draft").map(
			(f) => f.path,
		);
		expect(paths.sort()).toEqual(
			["Arr D.md", "Draft A.md", "Draft B.md", "Sub/Draft F.md"].sort(),
		);
	});

	it("presence mode matches any note that has the field (including null value)", () => {
		const paths = getMarkdownFilesWithProperty(app, "type").map((f) => f.path);
		expect(paths).toContain("Empty E.md");
		expect(paths).not.toContain("None G.md");
		expect(paths).toHaveLength(6);
	});

	it("returns nothing for an empty field name", () => {
		expect(getMarkdownFilesWithProperty(app, "   ")).toEqual([]);
	});

	it("applies a folder pipe filter (intersection with the property match)", () => {
		const paths = getMarkdownFilesWithProperty(app, "type", "draft", {
			folder: "Sub",
		}).map((f) => f.path);
		expect(paths).toEqual(["Sub/Draft F.md"]);
	});

	it("applies an exclude-folder pipe filter", () => {
		const paths = getMarkdownFilesWithProperty(app, "type", "draft", {
			excludeFolders: ["Sub"],
		})
			.map((f) => f.path)
			.sort();
		expect(paths).toEqual(["Arr D.md", "Draft A.md", "Draft B.md"].sort());
	});

	it("applies tag pipe filters to scalar frontmatter tags", () => {
		const tagApp = makeApp([
			{
				path: "Draft A.md",
				basename: "Draft A",
				frontmatter: { type: "draft", tags: "work, project" },
			},
			{
				path: "Draft B.md",
				basename: "Draft B",
				frontmatter: { type: "draft", tags: "work" },
			},
			{
				path: "Note C.md",
				basename: "Note C",
				frontmatter: { type: "note", tags: "work, project" },
			},
		]);

		const paths = getMarkdownFilesWithProperty(tagApp, "type", "draft", {
			tags: ["work", "project"],
		}).map((f) => f.path);

		expect(paths).toEqual(["Draft A.md"]);
	});
});

describe("getMarkdownFilesInFolder", () => {
	function folderApp(paths: string[]): App {
		const files = paths.map((p) => ({
			path: p,
			basename: (p.split("/").pop() ?? p).replace(/\.md$/, ""),
		}));
		return {
			vault: { getMarkdownFiles: () => files as unknown as TFile[] },
		} as unknown as App;
	}

	const app = folderApp([
		"Projects/a.md",
		"Projects/sub/b.md",
		"ProjectsArchive/c.md",
		"Projects 2024/d.md",
		"Projects.md",
		"Other/e.md",
	]);

	it("anchors a bare folder name and ignores prefix-sharing siblings", () => {
		const paths = getMarkdownFilesInFolder(app, "Projects")
			.map((f) => f.path)
			.sort();
		// NOT ProjectsArchive/, "Projects 2024/", or the sibling file Projects.md.
		expect(paths).toEqual(["Projects/a.md", "Projects/sub/b.md"].sort());
	});

	it("treats a trailing slash identically (callers pre-append '/')", () => {
		const paths = getMarkdownFilesInFolder(app, "Projects/")
			.map((f) => f.path)
			.sort();
		expect(paths).toEqual(["Projects/a.md", "Projects/sub/b.md"].sort());
	});

	it("returns the whole vault for an empty folder path", () => {
		expect(getMarkdownFilesInFolder(app, "").length).toBe(6);
	});
});

describe("tag-based vault queries", () => {
	const app = makeApp([
		{
			path: "Comma.md",
			basename: "Comma",
			frontmatter: { tags: "work, project" },
		},
		{
			path: "Space.md",
			basename: "Space",
			frontmatter: { tags: "#work project" },
		},
		{
			path: "Singular.md",
			basename: "Singular",
			frontmatter: { tag: "#work, project" },
		},
		{
			path: "Object.md",
			basename: "Object",
			frontmatter: { tags: { tag: "work" } },
		},
	]);

	it("finds bare tag targets with scalar frontmatter tags", () => {
		const paths = getMarkdownFilesWithTag(app, "#work").map((f) => f.path);

		expect(paths.sort()).toEqual(
			["Comma.md", "Singular.md", "Space.md"].sort(),
		);
	});

	it("matches compound filters against scalar frontmatter tags", () => {
		const paths = getMarkdownFilesMatchingFilter(app, {
			tags: ["work", "project"],
		}).map((f) => f.path);

		expect(paths.sort()).toEqual(
			["Comma.md", "Singular.md", "Space.md"].sort(),
		);
	});

	it("excludes scalar frontmatter tags", () => {
		const paths = getMarkdownFilesMatchingFilter(app, {
			excludeTags: ["project"],
		}).map((f) => f.path);

		expect(paths).toEqual(["Object.md"]);
	});
});
