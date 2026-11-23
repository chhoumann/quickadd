// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { FILE_PICK_PREFIX } from "src/utils/fileSyntax";

const mocks = vi.hoisted(() => ({
	collectFieldValuesWithSource: vi.fn(),
}));

vi.mock("src/utils/FieldValueCollector", () => ({
	collectFieldValuesWithSource: mocks.collectFieldValuesWithSource,
}));

import { FieldLinkInputSuggest, type FieldLinkPick } from "./FieldLinkInputSuggest";

const notes = ["Ted Chiang", "Books", "Neal Stephenson"].map((basename, index) =>
	Object.assign(new TFile(), { path: `${basename}.md`, name: `${basename}.md`, basename, extension: "md", stat: { mtime: index } }),
);

const app = {
	dom: { appContainerEl: document.body },
	keymap: { pushScope: vi.fn(), popScope: vi.fn() },
	vault: {
		getMarkdownFiles: () => [...notes],
		getAbstractFileByPath: (path: string) => notes.find((note) => note.path === path) ?? null,
	},
	metadataCache: {
		getFirstLinkpathDest: (target: string) =>
			notes.find((note) => note.basename.toLowerCase() === target.toLowerCase()) ?? null,
		getFileCache: (file: TFile) =>
			file.basename === "Neal Stephenson" ? { frontmatter: { aliases: ["Neal"] } } : null,
	},
	fileManager: { generateMarkdownLink: (file: TFile) => `[[${file.basename}]]` },
} as unknown as App;

function createSuggest(picked: string[] = [], multiSelect = false) {
	const input = document.createElement("input");
	document.body.appendChild(input);
	input.focus();
	const onSelect = vi.fn((pick: FieldLinkPick) => picked.push(pick.value));
	const suggest = new FieldLinkInputSuggest(app, input, "author|link", () => picked, onSelect, multiSelect);
	return { input, onSelect, suggest };
}

function names(suggestions: Awaited<ReturnType<FieldLinkInputSuggest["getSuggestions"]>>): string[] {
	return suggestions.map((s) => (s.kind === "option" ? s.option.display : `Link to ${s.link}`));
}

describe("FieldLinkInputSuggest", () => {
	beforeEach(() => {
		mocks.collectFieldValuesWithSource.mockReset();
		mocks.collectFieldValuesWithSource.mockResolvedValue({
			values: [
				{ value: "[[Books]]", sourcePath: "Note.md" },
				{ value: "[[Missing]]", sourcePath: "Note.md" },
			],
			hasDefaultValue: false,
		});
	});

	it("lists the values, then other notes and a new link as you type, without picked ones", async () => {
		const { suggest } = createSuggest([`${FILE_PICK_PREFIX}Books.md`]);
		expect(names(await suggest.getSuggestions(""))).toEqual(["Missing"]);
		expect(names(await suggest.getSuggestions("Ted"))).toEqual(["Ted Chiang", "Link to [[Ted]]"]);
		suggest.destroy();
	});

	it("reads the values once per visit to the input", async () => {
		const { input, suggest } = createSuggest();
		await suggest.getSuggestions("");
		await suggest.getSuggestions("B");
		expect(mocks.collectFieldValuesWithSource).toHaveBeenCalledTimes(1);
		input.blur();
		input.focus();
		await suggest.getSuggestions("");
		expect(mocks.collectFieldValuesWithSource).toHaveBeenCalledTimes(2);
		suggest.destroy();
	});

	it("hands over an encoded @file: pick for vault notes so the formatter resolves relative links", async () => {
		const { input, onSelect, suggest } = createSuggest();
		const [ted] = await suggest.getSuggestions("Ted Chiang");
		input.value = "Ted Chiang";
		suggest.selectSuggestion(ted);
		expect(onSelect).toHaveBeenCalledWith({
			value: `${FILE_PICK_PREFIX}Ted Chiang.md`,
			display: "Ted Chiang",
			unresolved: false,
			title: "Ted Chiang.md",
		});
		expect(input.value).toBe("");
		suggest.destroy();
	});

	it("resolves typed text and encoded @file: picks before and after the values are read", async () => {
		const { suggest } = createSuggest();
		expect(suggest.resolveTypedSync("ted chiang")).toEqual({
			value: `${FILE_PICK_PREFIX}Ted Chiang.md`,
			display: "Ted Chiang",
			unresolved: false,
			title: "Ted Chiang.md",
		});
		expect(suggest.resolveTypedSync(`${FILE_PICK_PREFIX}Ted Chiang.md`)).toEqual({
			value: `${FILE_PICK_PREFIX}Ted Chiang.md`,
			display: "Ted Chiang",
			unresolved: false,
			title: "Ted Chiang.md",
		});
		expect(suggest.resolveTypedSync("Neal")).toEqual({
			value: `${FILE_PICK_PREFIX}Neal Stephenson.md`,
			display: "Neal Stephenson",
			unresolved: false,
			title: "Neal Stephenson.md",
		});
		expect(suggest.resolveTypedSync("[[Nobody|N]]")).toEqual({
			value: "[[Nobody|N]]",
			display: "Nobody",
			unresolved: true,
			title: "[[Nobody|N]]",
		});
		expect(suggest.resolveTypedSync(" ")).toBeNull();
		await suggest.getSuggestions("");
		expect(suggest.resolveTypedSync("Neal")).toEqual({
			value: `${FILE_PICK_PREFIX}Neal Stephenson.md`,
			display: "Neal Stephenson",
			unresolved: false,
			title: "Neal Stephenson.md",
		});
		expect(suggest.resolveTypedSync("missing")).toEqual({
			value: "[[Missing]]",
			display: "Missing",
			unresolved: true,
			title: "[[Missing]]",
		});
		suggest.destroy();
	});

	it("does not silently bind a pasted relative link to a root note when destination is unknown", async () => {
		const rootPerson = Object.assign(new TFile(), { path: "Person.md", name: "Person.md", basename: "Person", extension: "md", stat: { mtime: 2 } });
		const eastPerson = Object.assign(new TFile(), { path: "East/Person.md", name: "Person.md", basename: "Person", extension: "md", stat: { mtime: 1 } });
		const relFiles = [rootPerson, eastPerson];
		const relApp = {
			dom: { appContainerEl: document.body },
			keymap: { pushScope: vi.fn(), popScope: vi.fn() },
			vault: {
				getMarkdownFiles: () => [...relFiles],
				getAbstractFileByPath: (path: string) => relFiles.find((file) => file.path === path) ?? null,
			},
			metadataCache: {
				getFirstLinkpathDest: (target: string, sourcePath: string) => {
					if (target === "./Person" && sourcePath === "") return rootPerson;
					if (target === "./Person" && sourcePath.startsWith("East/")) return eastPerson;
					return null;
				},
				getFileCache: () => null,
			},
			fileManager: { generateMarkdownLink: (file: TFile) => `[${file.basename}](${file.path})` },
		} as unknown as App;
		mocks.collectFieldValuesWithSource.mockResolvedValue({ values: [], hasDefaultValue: false });
		const input = document.createElement("input");
		document.body.appendChild(input);
		input.focus();
		const suggest = new FieldLinkInputSuggest(relApp, input, "owner|link", () => [], vi.fn(), false);

		expect(suggest.resolveTypedSync("[Person](./Person.md)")).toEqual({
			value: "[Person](./Person.md)",
			display: "./Person",
			unresolved: true,
			title: "[Person](./Person.md)",
		});
		expect(suggest.resolveTypedSync("[Person](Person.md)")).toEqual({
			value: "[Person](Person.md)",
			display: "Person",
			unresolved: true,
			title: "[Person](Person.md)",
		});
		const suggestions = await suggest.getSuggestions("[Person](./Person.md)");
		const optionPaths = suggestions.flatMap((s) =>
			s.kind === "option" && s.option.kind === "file" ? [s.option.path] : [],
		);
		expect(optionPaths).toEqual(expect.arrayContaining(["Person.md", "East/Person.md"]));
		expect(suggest.resolveTypedSync("[Person](./Person.md)")).toEqual({
			value: "[Person](./Person.md)",
			display: "./Person",
			unresolved: true,
			title: "[Person](./Person.md)",
		});
		expect(suggest.resolveTypedSync("[Person](Person.md)")).toEqual({
			value: "[Person](Person.md)",
			display: "Person",
			unresolved: true,
			title: "[Person](Person.md)",
		});
		suggest.destroy();
	});
});
