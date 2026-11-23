import { TFile, type App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { IChoiceExecutor } from "../../IChoiceExecutor";
import { FILE_CUSTOM_PREFIX, FILE_PICK_PREFIX, parseFileToken } from "../../utils/fileSyntax";
import MultiSuggester from "../../gui/MultiSuggester/multiSuggester";
import { FieldLinkSuggester } from "../../gui/FieldLinkSuggester/fieldLinkSuggester";
import type { FieldLinkOptions } from "../../utils/fieldLinkValues";
import { suggestForField, suggestForFile } from "./vaultPrompts";

const files = ["People/Thomas Anderson.md", "People/Neo Classic.md"].map((path) =>
	Object.assign(new TFile(), {
		path,
		name: path.slice("People/".length),
		basename: path.slice("People/".length, -".md".length),
		extension: "md",
	}),
);

vi.mock("../../utils/vaultQueries", () => ({ getFileTokenFiles: () => files }));

const fieldValues = vi.hoisted(() => ({ values: [] as string[], hasDefaultValue: false }));
vi.mock("../../utils/FieldValueCollector", () => ({
	collectFieldValuesProcessedDetailed: async () => fieldValues,
	collectFieldValuesWithSource: async () => ({
		values: fieldValues.values.map((value) => ({ value, sourcePath: "" })),
		hasDefaultValue: fieldValues.hasDefaultValue,
	}),
}));
vi.mock("../../gui/MultiSuggester/multiSuggester", () => ({ default: { Suggest: vi.fn() } }));
vi.mock("../../gui/FieldLinkSuggester/fieldLinkSuggester", () => ({ FieldLinkSuggester: { Suggest: vi.fn() } }));

const app = {
	metadataCache: {
		getFileCache: (file: TFile) =>
			file.basename === "Thomas Anderson" ? { frontmatter: { aliases: ["Neo", "The One"] } } : null,
	},
} as unknown as App;

// A remote client (Raycast) filters by title, so a user who types a note's
// alias sends it as a custom value.
function remoteReply(reply: string, token = "People|custom") {
	const suggester = vi.fn(async () => reply);
	const suggesterMulti = vi.fn(async () => [reply]);
	const executor = { promptProvider: { suggester, suggesterMulti } } as unknown as IChoiceExecutor;
	const parsed = parseFileToken(token);
	if (!parsed) throw new Error("token did not parse");
	return suggestForFile({ app, executor, getSourcePath: () => null }, parsed);
}

describe("suggestForFile with a remote client", () => {
	it("picks the note whose alias was typed (#2062)", async () => {
		await expect(remoteReply("the one")).resolves.toBe(`${FILE_PICK_PREFIX}People/Thomas Anderson.md`);
	});

	it("keeps any other typed text as a custom value", async () => {
		await expect(remoteReply("Niobe")).resolves.toBe(`${FILE_CUSTOM_PREFIX}Niobe`);
	});

	it("picks the note whose alias was typed in a multi-select", async () => {
		await expect(remoteReply("the one", "People|multi|custom")).resolves
			.toEqual([`${FILE_PICK_PREFIX}People/Thomas Anderson.md`]);
		await expect(remoteReply("Niobe", "People|multi|custom")).resolves
			.toEqual([`${FILE_CUSTOM_PREFIX}Niobe`]);
	});
});

describe("suggestForField with |link (issue #2295)", () => {
	const notes = ["Ted Chiang.md", "Books.md", "Reading List.md"].map((path, index) =>
		Object.assign(new TFile(), {
			path,
			name: path,
			basename: path.slice(0, -".md".length),
			extension: "md",
			stat: { mtime: index },
		}),
	);
	const linkApp = {
		vault: { getMarkdownFiles: () => [...notes] },
		metadataCache: {
			getFirstLinkpathDest: (target: string) =>
				notes.find((note) => note.basename.toLowerCase() === target.toLowerCase()) ?? null,
			getFileCache: () => null,
		},
		fileManager: { generateMarkdownLink: (file: TFile) => `[[${file.basename}]]` },
	} as unknown as App;

	function run(token: string, promptProvider?: object) {
		const executor = (promptProvider ? { promptProvider } : undefined) as IChoiceExecutor | undefined;
		return suggestForField({ app: linkApp, executor, getSourcePath: () => null }, token);
	}

	it("shows a remote client existing values first, then unused vault notes, and links picked or custom replies", async () => {
		fieldValues.values = ["[[Books]]", "[[Ted Chiang|Ted]]", "[[Missing]]"];
		const generateMarkdownLink = vi.fn((file: TFile) => `[[${file.basename}]]`);
		const remoteApp = { ...linkApp, fileManager: { generateMarkdownLink } } as unknown as App;
		const suggester = vi.fn(async () => "file:Reading List.md");

		await expect(
			suggestForField(
				{ app: remoteApp, executor: { promptProvider: { suggester } } as unknown as IChoiceExecutor, getSourcePath: () => null },
				"author|link",
			),
		).resolves.toBe("[[Reading List]]");
		expect(suggester).toHaveBeenCalledWith(
			["Books", "Missing", "Ted Chiang", "Reading List"],
			["file:Books.md", "unresolved:missing", "file:Ted Chiang.md", "file:Reading List.md"],
			"Enter value for author",
			true,
		);
		expect(generateMarkdownLink).toHaveBeenCalledTimes(1);
	});

	it("names the default by its note, not its link", async () => {
		fieldValues.values = ["[[Books]]"];
		fieldValues.hasDefaultValue = true;
		vi.mocked(FieldLinkSuggester.Suggest).mockResolvedValueOnce("[[Books]]");

		await expect(run("category|link|default:[[Books]]")).resolves.toBe("[[Books]]");
		expect(vi.mocked(FieldLinkSuggester.Suggest).mock.lastCall?.[2]).toEqual({
			placeholder: "Enter value for category (default: Books)",
		});
		fieldValues.hasDefaultValue = false;
	});

	it("offers all notes to a remote multi-select and writes its replies as links, once each", async () => {
		fieldValues.values = ["[[Books]]"];
		const suggesterMulti = vi.fn(async () => ["file:Books.md", "file:Reading List.md", "books", "Nobody"]);

		await expect(run("categories|multi|link", { suggesterMulti })).resolves.toEqual([
			"[[Books]]",
			"[[Reading List]]",
			"[[Nobody]]",
		]);
		expect(suggesterMulti).toHaveBeenCalledWith(
			["Books", "Reading List", "Ted Chiang"],
			["file:Books.md", "file:Reading List.md", "file:Ted Chiang.md"],
			{ placeholder: "Select values for categories", allowCustomInput: true, preselected: undefined },
		);
	});

	it("gives the in-app multi-select link labels and other notes to add", async () => {
		fieldValues.values = ["[[Books]]", "[[Missing]]"];
		vi.mocked(MultiSuggester.Suggest).mockResolvedValueOnce(["[[Books]]", "Ted Chiang", "[[Books]]"]);

		await expect(run("categories|multi|link")).resolves.toEqual(["[[Books]]", "[[Ted Chiang]]"]);
		const [, displays, items, options] = vi.mocked(MultiSuggester.Suggest).mock.lastCall ?? [];
		expect(displays).toEqual(["Books", "Missing"]);
		expect(items).toEqual(["[[Books]]", "[[Missing]]"]);
		expect(options?.linkValues).toBe(true);
		expect([...(options?.unresolvedValues ?? [])]).toEqual(["[[Missing]]"]);
		expect(options?.customLabel?.("[[Ted Chiang]]")).toBe("Ted Chiang");
		const suggested = options?.suggestCustom?.("e", new Set(["[[Books]]", "[[Reading List]]"])) ?? [];
		expect(suggested.map((s) => (s.kind === "option" ? s.option.display : s.link))).toEqual(["Ted Chiang", "[[e]]"]);
	});

	it("opens the in-app picker on the values even when there are none", async () => {
		fieldValues.values = [];
		vi.mocked(FieldLinkSuggester.Suggest).mockResolvedValueOnce("[[Nobody]]");

		await expect(run("author|link")).resolves.toBe("[[Nobody]]");
		const links = vi.mocked(FieldLinkSuggester.Suggest).mock.lastCall?.[1] as FieldLinkOptions;
		expect(links.existingCount).toBe(0);
		expect(links.otherOptions.map((option) => option.display)).toEqual(["Reading List", "Books", "Ted Chiang"]);
	});
});
