import { beforeEach, describe, expect, it, vi } from "vitest";

const { inputSuggestMock } = vi.hoisted(() => ({
	inputSuggestMock: vi.fn(),
}));

vi.mock("src/gui/InputSuggester/inputSuggester", () => ({
	default: {
		Suggest: inputSuggestMock,
	},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

import { TFile, type App } from "obsidian";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import {
	promptForTemplateNoteDiscovery,
	shouldRunTemplateNoteDiscovery,
	testExports,
} from "./templateNoteDiscovery";

function file(path: string): TFile {
	const tfile = new TFile();
	tfile.path = path;
	tfile.name = path.split("/").pop() ?? path;
	tfile.basename = tfile.name.replace(/\.md$/i, "");
	tfile.extension = "md";
	tfile.stat = { ctime: 0, mtime: 0, size: 0 };
	tfile.parent = {
		path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
	} as never;
	return tfile;
}

function choice(
	overrides: Partial<ITemplateChoice> = {},
): ITemplateChoice {
	return {
		id: "template",
		name: "Project note",
		type: "Template",
		command: false,
		templatePath: "Templates/Project.md",
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		fileNameFormat: { enabled: false, format: "{{VALUE}}" },
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "source",
			focus: false,
		},
		fileExistsBehavior: { kind: "prompt" },
		discoverExistingNotesBeforeCreate: true,
		...overrides,
	};
}

function app(files: TFile[] = []): App {
	return {
		vault: {
			getMarkdownFiles: vi.fn(() => files),
			getAbstractFileByPath: vi.fn((path: string) =>
				files.find((entry) => entry.path === path) ?? null,
			),
		},
		workspace: {
			getLastOpenFiles: vi.fn(() => []),
		},
		metadataCache: {
			getFileCache: vi.fn((entry: TFile) =>
				entry.basename === "Alice"
					? { frontmatter: { aliases: ["A. Example"] } }
					: { frontmatter: {} },
			),
			unresolvedLinks: {
				"Source.md": {
					"Missing Project": 1,
					"Projects/Missing Roadmap": 1,
					"Existing/Alice": 1,
				},
			},
			isUserIgnored: vi.fn(() => false),
		},
	} as unknown as App;
}

describe("template note discovery", () => {
	beforeEach(() => {
		inputSuggestMock.mockReset();
	});

	it("only runs for opted-in default title prompts with no seeded value", () => {
		expect(
			shouldRunTemplateNoteDiscovery(choice(), "{{VALUE}}", undefined),
		).toBe(true);
		expect(
			shouldRunTemplateNoteDiscovery(
				choice({ fileNameFormat: { enabled: true, format: "{{VALUE}}" } }),
				"{{VALUE}}",
				undefined,
			),
		).toBe(true);
		expect(
			shouldRunTemplateNoteDiscovery(
				choice({ fileNameFormat: { enabled: true, format: "{{NAME}}" } }),
				"{{NAME}}",
				undefined,
			),
		).toBe(true);
		expect(
			shouldRunTemplateNoteDiscovery(choice(), "{{VALUE}}", "Seeded"),
		).toBe(false);
		expect(
			shouldRunTemplateNoteDiscovery(
				choice({ discoverExistingNotesBeforeCreate: false }),
				"{{VALUE}}",
				undefined,
			),
		).toBe(false);
		expect(
			shouldRunTemplateNoteDiscovery(
				choice({ fileNameFormat: { enabled: true, format: "Project {{VALUE}}" } }),
				"Project {{VALUE}}",
				undefined,
			),
		).toBe(false);
	});

	it("builds existing-note and unresolved-link candidates for the picker", () => {
		const alice = file("Existing/Alice.md");
		const built = testExports.buildDiscoveryCandidates(app([alice]), choice());

		expect(built.candidates.map((candidate) => candidate.display)).toContain(
			"Alice Existing/Alice.md A. Example",
		);
		expect(built.candidates.map((candidate) => candidate.unresolvedTitle)).toEqual(
			expect.arrayContaining(["Missing Project", "Projects/Missing Roadmap"]),
		);
		expect(built.candidates.map((candidate) => candidate.unresolvedTitle)).not.toContain(
			"Existing/Alice",
		);
	});

	it("excludes the selected literal template file from existing-note candidates", () => {
		const template = file("Templates/Project.md");
		const alice = file("Existing/Alice.md");
		const built = testExports.buildDiscoveryCandidates(
			app([template, alice]),
			choice({ templatePath: "Templates/Project.md" }),
		);

		expect(built.candidates.map((candidate) => candidate.renderPath)).toContain(
			"Existing/Alice.md",
		);
		expect(built.candidates.map((candidate) => candidate.renderPath)).not.toContain(
			"Templates/Project.md",
		);
	});

	it("returns a tagged existing-file result when an existing row is selected", async () => {
		const alice = file("People/Alice.md");
		inputSuggestMock.mockImplementation(async (_app, _display, items) => items[0]);

		const result = await promptForTemplateNoteDiscovery(app([alice]), choice());

		expect(result).toEqual({ kind: "openExisting", file: alice });
	});

	it("returns a create result for unresolved-link rows", async () => {
		const alice = file("People/Alice.md");
		inputSuggestMock.mockImplementation(async (_app, _display, items) =>
			items.find((item: string) => item.includes("Missing Project")),
		);

		const result = await promptForTemplateNoteDiscovery(app([alice]), choice());

		expect(result).toEqual({ kind: "create", title: "Missing Project" });
	});

	it("tags foldered unresolved-link rows with a vault-relative target path", async () => {
		const alice = file("People/Alice.md");
		inputSuggestMock.mockImplementation(async (_app, _display, items) =>
			items.find((item: string) => item.includes("Projects/Missing Roadmap")),
		);

		const result = await promptForTemplateNoteDiscovery(app([alice]), choice());

		expect(result).toEqual({
			kind: "create",
			title: "Projects/Missing Roadmap",
			vaultRelativePath: "Projects/Missing Roadmap",
		});
	});

	it("aborts instead of creating a sentinel-named note when a selected existing row is stale", async () => {
		const alice = file("People/Alice.md");
		const staleApp = app([alice]);
		(staleApp.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>)
			.mockReturnValueOnce(null);
		inputSuggestMock.mockImplementation(async (_app, _display, items) => items[0]);

		await expect(
			promptForTemplateNoteDiscovery(staleApp, choice()),
		).rejects.toThrow("Selected note no longer exists");
	});

	it("suppresses the generic create row for exact existing or unresolved names", async () => {
		const alice = file("People/Alice.md");
		inputSuggestMock.mockResolvedValue("Fresh Idea");

		await promptForTemplateNoteDiscovery(app([alice]), choice());

		const options = inputSuggestMock.mock.calls[0]?.[3];
		expect(options.valueExists("Alice")).toBe(true);
		expect(options.valueExists("People/Alice")).toBe(true);
		expect(options.valueExists("Missing Project")).toBe(true);
		expect(options.valueExists("Fresh Idea")).toBe(false);
	});
});
