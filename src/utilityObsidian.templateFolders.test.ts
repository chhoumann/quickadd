import { type App, TFile, TFolder } from "obsidian";
import { describe, expect, it } from "vitest";
import {
	buildTemplateInclusionRegex,
	getTemplateOutputExtension,
	getTemplateFile,
	isPathWithinTemplateFolders,
	normalizeTemplateFolderPaths,
	normalizeTemplateSourceExtensions,
	stripTemplateOutputExtension,
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

	it("resolves eta template source files by default", () => {
		const app = appWith([file("Templates/Daily.eta")]);
		expect(getTemplateFile(app, "Templates/Daily.eta")?.path).toBe(
			"Templates/Daily.eta",
		);
	});

	it("prefers exact source-only template files over markdown fallback", () => {
		const app = appWith([
			file("Templates/Daily.eta"),
			file("Templates/Daily.eta.md"),
		]);
		expect(getTemplateFile(app, "Templates/Daily.eta")?.path).toBe(
			"Templates/Daily.eta",
		);
	});

	it("keeps old markdown fallback for missing source-only template files", () => {
		const app = appWith([file("Templates/Daily.eta.md")]);
		expect(getTemplateFile(app, "Templates/Daily.eta")?.path).toBe(
			"Templates/Daily.eta.md",
		);
	});

	it("resolves configured source-only template extensions", () => {
		const app = appWith([file("Templates/Daily.tpl")]);
		expect(getTemplateFile(app, "Templates/Daily.tpl", ["tpl"])?.path).toBe(
			"Templates/Daily.tpl",
		);
	});

	it("appends .md for non-configured source extensions", () => {
		const app = appWith([file("Templates/Daily.tpl.md")]);
		expect(getTemplateFile(app, "Templates/Daily.tpl", [])?.path).toBe(
			"Templates/Daily.tpl.md",
		);
	});

	it("trims surrounding whitespace before resolving", () => {
		const app = appWith([file("Templates/Daily.md")]);
		expect(getTemplateFile(app, "  /Templates/Daily  ")?.path).toBe(
			"Templates/Daily.md",
		);
	});

	it("returns null for blank/whitespace-only input", () => {
		const app = appWith([file("Templates/Daily.md")]);
		expect(getTemplateFile(app, "")).toBeNull();
		expect(getTemplateFile(app, "   ")).toBeNull();
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

describe("template source extension helpers", () => {
	it("normalizes configured source extensions", () => {
		expect(
			normalizeTemplateSourceExtensions([
				" .ETA ",
				"tpl",
				"md",
				"bad/path",
				"tpl",
			]),
		).toEqual(["eta", "tpl"]);
		expect(normalizeTemplateSourceExtensions("eta, tpl\nliquid")).toEqual([
			"eta",
			"tpl",
			"liquid",
		]);
	});

	it("maps source-only template extensions to markdown output", () => {
		expect(getTemplateOutputExtension("Templates/Daily.eta")).toBe(".md");
		expect(getTemplateOutputExtension("Templates/Daily.tpl")).toBe(".md");
		expect(getTemplateOutputExtension("Templates/Board.canvas")).toBe(".canvas");
		expect(getTemplateOutputExtension("Templates/View.base")).toBe(".base");
	});

	it("strips only native output extensions from target file names", () => {
		expect(stripTemplateOutputExtension("Notes/Daily.md")).toBe("Notes/Daily");
		expect(stripTemplateOutputExtension("Notes/Board.canvas")).toBe("Notes/Board");
		expect(stripTemplateOutputExtension("Notes/Daily.eta")).toBe(
			"Notes/Daily.eta",
		);
	});

	it("builds template inclusion regexes from configured source extensions", () => {
		const regex = buildTemplateInclusionRegex(["eta", "tpl"]);
		expect(regex.exec("{{TEMPLATE:Templates/A.eta}}")?.[1]).toBe(
			"Templates/A.eta",
		);
		expect(regex.exec("{{TEMPLATE:Templates/A.tpl}}")?.[1]).toBe(
			"Templates/A.tpl",
		);
		expect(regex.test("{{TEMPLATE:Templates/A.png}}")).toBe(false);
	});
});
