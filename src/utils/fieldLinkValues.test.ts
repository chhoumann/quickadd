import { TFile, type App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { collectFieldValuesWithSource } from "./FieldValueCollector";
import { buildFileDisplayInfos, FILE_PICK_PREFIX } from "./fileSyntax";
import {
	createFieldLinkOptions,
	ensureLinkValue,
	FieldLinkOptions,
	type FieldLinkSuggestion,
	type FieldLinkVault,
	isLinkValue,
	linkifyFieldValue,
	linkTargetOf,
	rankFieldLinkOptions,
} from "./fieldLinkValues";

function note(path: string): TFile {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return Object.assign(new TFile(), { path, name, basename: name.replace(/\.md$/, ""), extension: "md" });
}

const FILES_NEWEST_FIRST = [
	"Ted Chiang.md",
	"The Diamond Age.md",
	"People/Paul Person.md",
	"People/Other Person.md",
	"Books.md",
	"Neal Stephenson.md",
	"Zebra.md",
	"Apple.md",
	"Personal.md",
].map(note);

const ALIASES: Record<string, string[]> = { "Neal Stephenson.md": ["Neal"], "Books.md": ["Reading"] };

function vault(files: TFile[] = FILES_NEWEST_FIRST): FieldLinkVault & { linkFor: ReturnType<typeof vi.fn> } {
	const byName = new Map(files.map((file) => [file.basename.toLowerCase(), file]));
	return {
		files,
		resolve: (target) =>
			byName.get(target.toLowerCase()) ??
			files.find((file) => file.path === target || file.path === `${target}.md`) ??
			null,
		linkFor: vi.fn((file: TFile) => `[[${file.basename}]]`),
		describe: (list) => list.map((file) => ({ label: file.basename, aliases: ALIASES[file.path] ?? [] })),
	};
}

function displays(suggestions: FieldLinkSuggestion[]): string[] {
	return suggestions.map((s) => (s.kind === "option" ? s.option.display : `Link to ${s.link}`));
}

describe("link value helpers", () => {
	it("recognises wikilinks and Markdown links, not plain text", () => {
		expect(isLinkValue("[[Ted Chiang]]")).toBe(true);
		expect(isLinkValue("![[cover.png]]")).toBe(true);
		expect(isLinkValue("[[#Details]]")).toBe(true);
		expect(isLinkValue("[[#^block-1]]")).toBe(true);
		expect(isLinkValue("[Details](#Details)")).toBe(true);
		expect(isLinkValue("[Details](#^block-1)")).toBe(true);
		expect(isLinkValue("[Book](Book (2024).md)")).toBe(true);
		expect(isLinkValue("[Book](<My Book (2024).md>)")).toBe(true);
		expect(isLinkValue("Ted Chiang")).toBe(false);
		expect(isLinkValue("[[]]")).toBe(false);
		expect(isLinkValue("[[   ]]")).toBe(false);
		expect(isLinkValue("[[#]]")).toBe(false);
		expect(isLinkValue("[[#^]]")).toBe(false);
		expect(isLinkValue("[[|alias]]")).toBe(false);
		expect(isLinkValue("[Details](#)")).toBe(false);
		expect(isLinkValue("[Book](   )")).toBe(false);
		expect(isLinkValue("[Book](Book (2024.md)")).toBe(false);
	});

	it("wraps plain text and leaves links as written", () => {
		expect(ensureLinkValue("  Ted Chiang ")).toBe("[[Ted Chiang]]");
		expect(ensureLinkValue("[[Ted Chiang|Ted]]")).toBe("[[Ted Chiang|Ted]]");
		expect(ensureLinkValue("[[#Details]]")).toBe("[[#Details]]");
		expect(ensureLinkValue("[Details](#Details)")).toBe("[Details](#Details)");
		expect(ensureLinkValue("[T](Ted%20Chiang.md)")).toBe("[T](Ted%20Chiang.md)");
		expect(ensureLinkValue("  ")).toBe("");
	});

	it("reads the note a link names", () => {
		expect(linkTargetOf("[[Ted Chiang|Ted]]")).toBe("Ted Chiang");
		expect(linkTargetOf("[[Ted Chiang#Life]]")).toBe("Ted Chiang");
		expect(linkTargetOf("[[Ted Chiang#^block|x]]")).toBe("Ted Chiang");
		expect(linkTargetOf("[T](Ted%20Chiang.md#Life)")).toBe("Ted Chiang");
		expect(linkTargetOf("[B](<Book (2024).md>)")).toBe("Book (2024)");
		expect(linkTargetOf("[B](100%zz.md)")).toBe("100%zz");
		expect(linkTargetOf("Ted Chiang")).toBe("Ted Chiang");
	});

	it("links plain answers in strings and lists", () => {
		const resolve = (text: string) => `[[resolved/${text}]]`;
		expect(linkifyFieldValue("Ted", resolve)).toBe("[[resolved/Ted]]");
		expect(linkifyFieldValue("[[Ted]]", resolve)).toBe("[[Ted]]");
		expect(linkifyFieldValue(["Ted", " ", "[[Books]]"], resolve)).toEqual(["[[resolved/Ted]]", "[[Books]]"]);
		expect(linkifyFieldValue("Ted")).toBe("[[Ted]]");
		expect(linkifyFieldValue(undefined)).toBeUndefined();
	});
});

describe("FieldLinkOptions", () => {
	it("merges values that name the same note and sorts them by name", () => {
		const links = new FieldLinkOptions(
			["[[Zebra]]", "Apple", "[[Ted Chiang]]", "[[Ted Chiang|Ted]]", "[T](Ted%20Chiang.md)", "[[Missing]]", "[[missing#x]]"],
			vault(),
		);
		expect(links.existingOptions.map((o) => o.display)).toEqual(["Apple", "Missing", "Ted Chiang", "Zebra"]);
		expect(links.existingOptions.every((o) => o.existing)).toBe(true);
		const missing = links.existingOptions[1];
		expect(missing.kind === "unresolved" && missing.link).toBe("[[Missing]]");
	});

	it("keeps a default first", () => {
		const links = new FieldLinkOptions(["[[Zebra]]", "[[Apple]]"], vault(), { pinnedFirst: true });
		expect(links.existingOptions.map((o) => o.display)).toEqual(["Zebra", "Apple"]);
	});

	it("lists the other notes newest first, after the values", () => {
		const links = new FieldLinkOptions(["[[Books]]", "[[Apple]]"], vault());
		expect(links.otherOptions.map((o) => o.display)).toEqual([
			"Ted Chiang", "The Diamond Age", "Paul Person", "Other Person", "Neal Stephenson", "Zebra", "Personal",
		]);
		expect(links.otherOptions.some((o) => o.existing)).toBe(false);
	});

	it("generates a note's link only when asked, once", () => {
		const fake = vault();
		const links = new FieldLinkOptions(["[[Books]]"], fake);
		expect(fake.linkFor).not.toHaveBeenCalled();
		expect(links.linkForTyped("books")).toBe("[[Books]]");
		expect(links.linkForTyped("Books")).toBe("[[Books]]");
		expect(fake.linkFor).toHaveBeenCalledTimes(1);
	});

	it("resolves what was typed: a name, an alias, a link, or a new link", () => {
		const links = new FieldLinkOptions(["[[Missing Note]]"], vault());
		expect(links.linkForTyped("ted chiang")).toBe("[[Ted Chiang]]");
		expect(links.linkForTyped("Reading")).toBe("[[Books]]");
		expect(links.linkForTyped("[[Ted Chiang|Ted]]")).toBe("[[Ted Chiang]]");
		expect(links.linkForTyped("missing note")).toBe("[[Missing Note]]");
		expect(links.linkForTyped("[[missing note|m]]")).toBe("[[Missing Note]]");
		expect(links.linkForTyped("Nobody")).toBe("[[Nobody]]");
		expect(links.linkForTyped("[[Nobody|N]]")).toBe("[[Nobody|N]]");
		expect(links.linkForTyped("  ")).toBe("");
		expect(links.linkForTyped("file:Zebra.md")).toBe("[[Zebra]]");
	});

	it("lets a note's exact name win over another note's alias", () => {
		const files = [note("Neal.md"), note("Neal Stephenson.md")];
		const links = new FieldLinkOptions([], vault(files));
		expect(links.linkForTyped("Neal")).toBe("[[Neal]]");
	});

	it("resolves encoded @file: picks to their exact note option", () => {
		const links = new FieldLinkOptions([], vault());
		expect(links.linkForTyped(`${FILE_PICK_PREFIX}People/Paul Person.md`)).toBe("[[Paul Person]]");
		expect(links.displayFor(`${FILE_PICK_PREFIX}People/Paul Person.md`)).toBe("Paul Person");
		expect(links.isUnresolved(`${FILE_PICK_PREFIX}People/Paul Person.md`)).toBe(false);
	});

	it("keeps source-relative links from different folders as distinct existing picks", async () => {
		const eastBook = Object.assign(note("East/Book.md"), { stat: { mtime: 4 } });
		const westBook = Object.assign(note("West/Book.md"), { stat: { mtime: 3 } });
		const eastPerson = Object.assign(note("East/Person.md"), { stat: { mtime: 2 } });
		const westPerson = Object.assign(note("West/Person.md"), { stat: { mtime: 1 } });
		const files = [eastBook, westBook, eastPerson, westPerson];
		const resolveRelative = (target: string, sourcePath: string): TFile | null => {
			const folder = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
			const stripped = target.replace(/^\.\//, "");
			const candidate = folder ? `${folder}/${stripped}.md` : `${stripped}.md`;
			return files.find((file) => file.path === candidate) ?? null;
		};
		const app = {
			vault: { getMarkdownFiles: () => [...files] },
			metadataCache: {
				getFileCache: (file: TFile) =>
					file === eastBook || file === westBook
						? { frontmatter: { author: "[Person](./Person.md)" } }
						: null,
				getFirstLinkpathDest: (target: string, sourcePath: string) => resolveRelative(target, sourcePath),
			},
			fileManager: { generateMarkdownLink: (file: TFile) => `[[${file.path}]]` },
		} as unknown as App;

		const { values } = await collectFieldValuesWithSource(app, "author", {});
		const links = createFieldLinkOptions(app, values, "East/New.md");
		expect(links.existingOptions.map((o) => o.id)).toEqual(["file:East/Person.md", "file:West/Person.md"]);
		expect(links.existingOptions.map((o) => o.display)).toEqual(
			buildFileDisplayInfos([eastPerson, westPerson], () => null).map((info) => info.label),
		);

		const withDefaultAlways = await collectFieldValuesWithSource(app, "author", {
			defaultValue: "[Person](./Person.md)",
			defaultAlways: true,
		});
		const linksWithDefault = createFieldLinkOptions(app, withDefaultAlways.values, "East/New.md", {
			pinnedFirst: withDefaultAlways.hasDefaultValue,
		});
		expect(linksWithDefault.existingOptions.map((o) => o.id)).toEqual(["file:East/Person.md", "file:West/Person.md"]);

		expect(links.resolveTyped("Person", "West/Book.md")).toMatchObject({
			kind: "option",
			option: { id: "file:West/Person.md" },
		});
	});

	it("keeps existing heading-only links tied to their source notes and resolves unresolved relative links per source folder", () => {
		const eastBook = Object.assign(note("East/Book.md"), { stat: { mtime: 2 } });
		const westBook = Object.assign(note("West/Book.md"), { stat: { mtime: 1 } });
		const fakeVault: FieldLinkVault = {
			files: [eastBook, westBook],
			resolve: () => null,
			linkFor: (file, subpath) => `[[${file.path.replace(/\.md$/, "")}${subpath ?? ""}]]`,
			describe: (list) => buildFileDisplayInfos(list, () => null),
		};
		const links = new FieldLinkOptions(
			[
				{ value: "[[#Details]]", sourcePath: "East/Book.md" },
				{ value: "[[#Details]]", sourcePath: "West/Book.md" },
				{ value: "[Draft](./Draft.md)", sourcePath: "East/Book.md" },
				{ value: "[Draft](./Draft.md)", sourcePath: "West/Book.md" },
			],
			fakeVault,
		);
		expect(links.existingOptions.map((o) => links.linkForOption(o))).toEqual([
			"[[East/Book#Details]]",
			"[[West/Book#Details]]",
			"[[East/Draft]]",
			"[[West/Draft]]",
		]);
		expect(links.resolveTyped("[Draft](./Draft.md)", "East/Book.md")).toEqual({
			kind: "option",
			option: expect.objectContaining({ link: "[[East/Draft]]" }),
		});
		const emptyLinks = new FieldLinkOptions([], fakeVault);
		expect(emptyLinks.resolveTyped("[Draft](./Draft.md)", "East/Book.md")).toEqual({
			kind: "new",
			link: "[[East/Draft]]",
			display: "East/Draft",
		});
	});

	it("names values for display and tells unresolved ones apart", () => {
		const links = new FieldLinkOptions(["[[Missing]]"], vault());
		expect(links.displayFor("[[Ted Chiang]]")).toBe("Ted Chiang");
		expect(links.displayFor("[[Nobody|N]]")).toBe("Nobody");
		expect(links.isUnresolved("[[Ted Chiang]]")).toBe(false);
		expect(links.isUnresolved("[[Missing]]")).toBe(true);
		expect(links.isUnresolved("[[Nobody]]")).toBe(true);
	});
});

describe("rankFieldLinkOptions", () => {
	const limit = 50;

	it("lists only the existing values before anything is typed", () => {
		const links = new FieldLinkOptions(["[[Books]]", "[[Apple]]"], vault());
		expect(displays(rankFieldLinkOptions(links, "", { limit, scope: "all", includeNewRow: true }))).toEqual(["Apple", "Books"]);
		expect(rankFieldLinkOptions(links, " ", { limit, scope: "other-only", includeNewRow: true })).toEqual([]);
	});

	it("prefers an existing word-start match over an unused prefix match", () => {
		const links = new FieldLinkOptions(["[[Paul Person]]"], vault());
		const ranked = displays(rankFieldLinkOptions(links, "Person", { limit, scope: "all" }));
		expect(ranked).toEqual(["Paul Person", "Personal", "Other Person"]);
	});

	it("lets a much better match on another note come first", () => {
		const links = new FieldLinkOptions(["[[The Diamond Age]]"], vault());
		const ranked = displays(rankFieldLinkOptions(links, "Ted", { limit, scope: "all" }));
		expect(ranked[0]).toBe("Ted Chiang");
		expect(ranked).toContain("The Diamond Age");
	});

	it("matches aliases and says which one", () => {
		const links = new FieldLinkOptions([], vault());
		const [first] = rankFieldLinkOptions(links, "Reading", { limit, scope: "all" });
		expect(first.kind === "option" && first.option.display).toBe("Books");
		expect(first.kind === "option" && first.alias).toBe("Reading");
	});

	it("offers a new link after the notes, and keeps it within the limit", () => {
		const links = new FieldLinkOptions([], vault());
		expect(displays(rankFieldLinkOptions(links, "Pers", { limit, scope: "all", includeNewRow: true }))).toEqual([
			"Personal", "Paul Person", "Other Person", "Link to [[Pers]]",
		]);
		expect(displays(rankFieldLinkOptions(links, "Pers", { limit: 2, scope: "all", includeNewRow: true }))).toEqual([
			"Personal", "Link to [[Pers]]",
		]);
	});

	it("offers no new link for text that names a note or an alias", () => {
		const links = new FieldLinkOptions([], vault());
		const ranked = rankFieldLinkOptions(links, "neal", { limit, scope: "all", includeNewRow: true });
		expect(ranked.some((s) => s.kind === "new")).toBe(false);
	});

	it("surfaces the target note when a full wikilink or Markdown link is pasted", () => {
		const links = new FieldLinkOptions(["[[Books]]"], vault());
		expect(displays(rankFieldLinkOptions(links, "[[Books]]", { limit, scope: "all", includeNewRow: true }))).toContain("Books");
		expect(displays(rankFieldLinkOptions(links, "[Books](Books.md)", { limit, scope: "all", includeNewRow: true }))).toContain("Books");
		expect(displays(rankFieldLinkOptions(links, "[Paul](People/Paul%20Person.md)", { limit, scope: "all", includeNewRow: true }))[0]).toBe("Paul Person");
		expect(displays(rankFieldLinkOptions(links, "[[#Details]]", { limit, scope: "all", includeNewRow: true }))).toEqual([
			"Link to [[#Details]]",
		]);
	});

	it("searches only other notes for other-only, minus excluded ones", () => {
		const links = new FieldLinkOptions(["[[Paul Person]]"], vault());
		const excludeIds = new Set(["file:People/Other Person.md"]);
		expect(displays(rankFieldLinkOptions(links, "Person", { limit, scope: "other-only", excludeIds }))).toEqual(["Personal"]);
	});
});
