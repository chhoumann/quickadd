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
	const app = {
		dom: { appContainerEl: document.body },
		keymap: { pushScope: vi.fn(), popScope: vi.fn() },
		vault: {
			getMarkdownFiles: () => [file],
			getAbstractFileByPath: (path: string) => path === file.path ? file : null,
		},
		metadataCache: { getFileCache: () => null, unresolvedLinks: { "Source.md": { "Not Yet Created": 1 } } },
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

	it("resolves unselected text as a new title while preserving exact existing paths", () => {
		const { suggester } = createSuggest();
		expect(suggester.resolveInput("Project At")).toEqual({ kind: "create", title: "Project At" });
		expect(suggester.resolveInput("Projects/Project Atlas.md")).toEqual({ kind: "existing", path: "Projects/Project Atlas.md" });
		expect(() => suggester.resolveInput("../outside")).toThrow();
		expect(suggester.resolveInput("Unresolved link")).toEqual({ kind: "create", title: "Unresolved link" });
	});
});
