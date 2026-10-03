import { describe, expect, it } from "vitest";
import type { App, CliData, TFile } from "obsidian";
import { obsidianSuggestSource, suggestHandler, type LinkCandidate, type SuggestSource } from "./suggestCli";

function source(links: LinkCandidate[] | null, tags: Record<string, number> = {}): SuggestSource {
	return { linkCandidates: () => links, tagCounts: () => tags };
}

const suggest = (src: SuggestSource, params: Record<string, string>) =>
	suggestHandler(src, params as unknown as CliData);

const candidate = (overrides: Partial<LinkCandidate> & Pick<LinkCandidate, "path" | "linktext">): LinkCandidate => ({
	mtime: 0,
	excluded: false,
	...overrides,
});

describe("quickadd:suggest kind=links", () => {
	it("inserts the file's linktext before an alias, and keeps ambiguous paths", () => {
		const result = suggest(source([
			candidate({ path: "Projects/Plan.md", linktext: "Plan", mtime: 3 }),
			candidate({ path: "Projects/Plan.md", linktext: "Plan", alias: "Big Plan", mtime: 3 }),
			candidate({ path: "Archive/Meeting.md", linktext: "Archive/Meeting", mtime: 2 }),
			candidate({ path: "Projects/Meeting.md", linktext: "Projects/Meeting", mtime: 1 }),
		]), { kind: "links" });

		expect(result).toEqual({
			ok: true,
			kind: "links",
			items: [
				{ text: "Plan", path: "Projects/Plan.md" },
				{ text: "Plan|Big Plan", path: "Projects/Plan.md", alias: "Big Plan" },
				{ text: "Archive/Meeting", path: "Archive/Meeting.md" },
				{ text: "Projects/Meeting", path: "Projects/Meeting.md" },
			],
		});
	});

	it("orders newest first with excluded files last", () => {
		const result = suggest(source([
			candidate({ path: "old.md", linktext: "old", mtime: 1 }),
			candidate({ path: "Templates/new.md", linktext: "new", mtime: 9, excluded: true }),
			candidate({ path: "recent.md", linktext: "recent", mtime: 5 }),
		]), { kind: "links" });

		expect((result.items as { path: string }[]).map((item) => item.path)).toEqual([
			"recent.md",
			"old.md",
			"Templates/new.md",
		]);
	});

	it("errors instead of guessing when Obsidian lacks getLinkSuggestions", () => {
		expect(suggest(source(null), { kind: "links" })).toEqual({
			ok: false,
			error: "This Obsidian version has no link suggestions API; update Obsidian.",
		});
	});

	it("reads Obsidian's suggestions and skips unresolved targets", () => {
		const file = { path: "Notes/A.md", stat: { mtime: 7 } } as TFile;
		const app = {
			metadataCache: {
				getLinkSuggestions: () => [{ file, path: "Notes/A" }, { file: null, path: "Ghost" }],
				fileToLinktext: (f: TFile, sourcePath: string) => `${f.path}@${sourcePath}`,
				isUserIgnored: (path: string) => path === "Notes/A.md",
			},
		} as unknown as App;

		expect(obsidianSuggestSource(app).linkCandidates()).toEqual([
			{ path: "Notes/A.md", mtime: 7, linktext: "Notes/A.md@", alias: undefined, excluded: true },
		]);
		expect(obsidianSuggestSource({ metadataCache: {} } as unknown as App).linkCandidates()).toBeNull();
	});
});

describe("quickadd:suggest kind=tags", () => {
	it("drops the leading # and sorts by count, then name", () => {
		const result = suggest(source([], { "#idea": 2, "#work": 3, "#area": 2, "#idea/sub": 1 }), { kind: "tags" });

		expect(result).toEqual({
			ok: true,
			kind: "tags",
			items: [
				{ tag: "work", count: 3 },
				{ tag: "area", count: 2 },
				{ tag: "idea", count: 2 },
				{ tag: "idea/sub", count: 1 },
			],
		});
	});
});

describe("quickadd:suggest kind validation", () => {
	it.each<Record<string, string>>([{}, { kind: "files" }])("rejects %o", (params) => {
		expect(suggest(source([]), params)).toEqual({ ok: false, error: "kind must be links or tags" });
	});
});
