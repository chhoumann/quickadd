import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { TemplateChoice } from "src/types/choices/TemplateChoice";
import { NoteDiscoveryInputSuggest } from "./NoteDiscoveryInputSuggest";

const suggesters: NoteDiscoveryInputSuggest[] = [];

afterEach(() => {
	for (const suggester of suggesters) suggester.destroy();
	suggesters.length = 0;
	document.body.replaceChildren();
});

function createSuggest() {
	const file = Object.assign(new TFile(), {
		path: "Projects/Project Atlas.md", basename: "Project Atlas", extension: "md",
	});
	const other = Object.assign(new TFile(), { path: "Launch plan overview.md", basename: "Launch plan overview", extension: "md" });
	const app = {
		dom: { appContainerEl: document.body },
		keymap: { pushScope: vi.fn(), popScope: vi.fn() },
		vault: {
			getMarkdownFiles: () => [other, file],
			getAbstractFileByPath: (path: string) => path === file.path ? file : null,
		},
		metadataCache: { getFileCache: (entry: TFile) => entry === file ? ({ frontmatter: { aliases: ["Atlas plan", "Launch plan"] } }) : null, unresolvedLinks: { "Source.md": { "Not Yet Created": 1 } } },
		workspace: { getLastOpenFiles: () => [] },
	} as unknown as App;
	const input = document.createElement("input");
	document.body.appendChild(input);
	const selected = vi.fn();
	const suggester = new NoteDiscoveryInputSuggest(app, input, new TemplateChoice("Project"), selected);
	suggesters.push(suggester);
	return { suggester, selected };
}

describe("NoteDiscoveryInputSuggest", () => {
	it("puts a new title before matches so the default selection creates it", () => {
		const { suggester, selected } = createSuggest();
		const suggestions = suggester.getSuggestions("Project At");
		expect(suggestions).toHaveLength(2);
		suggester.selectSuggestion(suggestions[0]);
		expect(selected).toHaveBeenCalledWith({ kind: "create", title: "Project At" });
	});

	it("selects an exact existing title without offering a duplicate Create row", () => {
		const { suggester, selected } = createSuggest();
		const suggestions = suggester.getSuggestions("Project Atlas");
		expect(suggestions).toHaveLength(1);
		suggester.selectSuggestion(suggestions[0]);
		expect(selected).toHaveBeenCalledWith({ kind: "existing", path: "Projects/Project Atlas.md" });
	});

	it.each(["Atlas plan", "Launch plan", "LAUNCH PLAN"])("resolves exact alias %s to the existing note", (alias) => {
		const { suggester, selected } = createSuggest();
		const suggestions = suggester.getSuggestions(alias);
		expect(suggestions.some((suggestion) => suggestion.label.startsWith("Create new note:"))).toBe(false);
		suggester.selectSuggestion(suggestions[0]);
		expect(selected).toHaveBeenCalledWith({ kind: "existing", path: "Projects/Project Atlas.md" });
		expect(suggester.resolveInput(alias)).toEqual({ kind: "existing", path: "Projects/Project Atlas.md" });
	});

	it("resolves unselected text as a new title while preserving exact existing paths", () => {
		const { suggester } = createSuggest();
		expect(suggester.resolveInput("Project At")).toEqual({ kind: "create", title: "Project At" });
		expect(suggester.resolveInput("Projects/Project Atlas.md")).toEqual({ kind: "existing", path: "Projects/Project Atlas.md" });
		expect(() => suggester.resolveInput("../outside")).toThrow();
		expect(suggester.resolveInput("Unresolved link")).toEqual({ kind: "create", title: "Unresolved link" });
	});

	it("never interprets a custom create row as an encoded existing-note selection", () => {
		const { suggester, selected } = createSuggest();
		const text = "@quickadd-existing-note:Projects/Project Atlas.md";
		const custom = suggester.getSuggestions(text).find((option) => option.label.startsWith("Create new note:"));
		expect(custom).toBeDefined();
		if (!custom) throw new Error("Expected a custom title row");
		suggester.selectSuggestion(custom);
		expect(selected).toHaveBeenCalledWith({ kind: "create", title: text, vaultRelativePath: text });
		expect(suggester.resolveInput(text)).toEqual({ kind: "create", title: text, vaultRelativePath: text });
	});
});
