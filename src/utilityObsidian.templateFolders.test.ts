import { type App, TFile, TFolder } from "obsidian";
import { describe, expect, it } from "vitest";
import {
	getTemplateFile,
	isPathWithinTemplateFolders,
	normalizeTemplateFolderPaths,
} from "./utilityObsidian";

function file(path: string): TFile {
	const f = new TFile();
	f.path = path;
	f.name = path.split("/").pop() ?? path;
	f.extension = path.split(".").pop() ?? "";
	f.basename = f.name.replace(/\.[^.]+$/, "");
	return f;
}

function folder(path: string): TFolder {
	const f = new TFolder();
	f.path = path;
	f.name = path.split("/").pop() ?? path;
	return f;
}

/** Minimal App whose vault resolves a fixed set of abstract files by path. */
function appWith(entries: Array<TFile | TFolder>): App {
	const byPath = new Map(entries.map((e) => [e.path, e]));
	return {
		vault: {
			getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
		},
	} as unknown as App;
}

describe("normalizeTemplateFolderPaths", () => {
	it("returns an empty array for non-array input", () => {
		expect(normalizeTemplateFolderPaths(undefined)).toEqual([]);
		expect(normalizeTemplateFolderPaths(null)).toEqual([]);
		expect(normalizeTemplateFolderPaths("templates")).toEqual([]);
	});

	it("trims, strips leading/trailing slashes, and drops blanks", () => {
		expect(
			normalizeTemplateFolderPaths(["  templates/  ", "/notes/templates/"]),
		).toEqual(["templates", "notes/templates"]);
		expect(normalizeTemplateFolderPaths(["", "   ", "/"])).toEqual([]);
	});

	it("de-duplicates by canonical form, preserving first-seen order", () => {
		expect(
			normalizeTemplateFolderPaths(["templates", "templates/", "/templates"]),
		).toEqual(["templates"]);
		expect(normalizeTemplateFolderPaths(["b", "a", "b"])).toEqual(["b", "a"]);
	});

	it("ignores non-string entries", () => {
		expect(
			normalizeTemplateFolderPaths(["templates", 5, null, { x: 1 }]),
		).toEqual(["templates"]);
	});
});

describe("isPathWithinTemplateFolders", () => {
	it("matches everything when no folders are configured", () => {
		expect(isPathWithinTemplateFolders("anything/x.md", [])).toBe(true);
	});

	it("matches files inside a folder but not sibling-prefix folders", () => {
		expect(isPathWithinTemplateFolders("templates/a.md", ["templates"])).toBe(
			true,
		);
		// boundary-aware: "templates" must not match "templates-old"
		expect(
			isPathWithinTemplateFolders("templates-old/a.md", ["templates"]),
		).toBe(false);
	});

	it("matches a file whose path equals the folder", () => {
		expect(isPathWithinTemplateFolders("templates", ["templates"])).toBe(true);
	});

	it("matches any of several folders", () => {
		const folders = ["templates", "notes/tpl"];
		expect(isPathWithinTemplateFolders("notes/tpl/a.md", folders)).toBe(true);
		expect(isPathWithinTemplateFolders("other/a.md", folders)).toBe(false);
	});
});

describe("getTemplateFile", () => {
	it("appends .md when no template extension is present", () => {
		const app = appWith([file("Templates/Daily.md")]);
		expect(getTemplateFile(app, "Templates/Daily")?.path).toBe(
			"Templates/Daily.md",
		);
	});

	it("strips a leading slash before resolving (preflight bug fix)", () => {
		const app = appWith([file("Templates/Daily.md")]);
		expect(getTemplateFile(app, "/Templates/Daily")?.path).toBe(
			"Templates/Daily.md",
		);
	});

	it("resolves canvas and base templates without appending .md", () => {
		const app = appWith([
			file("Templates/Board.canvas"),
			file("Templates/View.base"),
		]);
		expect(getTemplateFile(app, "Templates/Board.canvas")?.path).toBe(
			"Templates/Board.canvas",
		);
		expect(getTemplateFile(app, "Templates/View.base")?.path).toBe(
			"Templates/View.base",
		);
	});

	it("returns null when the path resolves to nothing", () => {
		const app = appWith([]);
		expect(getTemplateFile(app, "Templates/Missing")).toBeNull();
	});

	it("returns null when the path resolves to a folder, not a file", () => {
		const app = appWith([folder("Templates")]);
		expect(getTemplateFile(app, "Templates.md")).toBeNull();
	});
});
