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

import { type App, type TFile } from "obsidian";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { promptForTemplateNoteDiscovery } from "./templateNoteDiscovery";

function choice(overrides: Partial<ITemplateChoice> = {}): ITemplateChoice {
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
			getAbstractFileByPath: vi.fn(
				(path: string) => files.find((entry) => entry.path === path) ?? null,
			),
		},
		workspace: {
			getLastOpenFiles: vi.fn(() => []),
		},
		metadataCache: {
			getFileCache: vi.fn(() => ({ frontmatter: {} })),
			unresolvedLinks: {},
			isUserIgnored: vi.fn(() => false),
		},
	} as unknown as App;
}

describe("template note discovery — typed name vault-relative parity (audit)", () => {
	beforeEach(() => {
		inputSuggestMock.mockReset();
	});

	it("tags a typed custom name containing '/' as a vault-relative path", async () => {
		// The user types a brand-new name with a folder segment that matches no
		// existing note or unresolved link, so it flows through the typed
		// custom-value branch. It must resolve like the unresolved-link branch
		// (vault-relative), not anchor under the configured/default folder.
		inputSuggestMock.mockResolvedValue("Projects/My New Note");

		const result = await promptForTemplateNoteDiscovery(app([]), choice());

		expect(result).toEqual({
			kind: "create",
			title: "Projects/My New Note",
			vaultRelativePath: "Projects/My New Note",
		});
	});

	it("leaves a plain typed name without a vault-relative path", async () => {
		inputSuggestMock.mockResolvedValue("My New Note");

		const result = await promptForTemplateNoteDiscovery(app([]), choice());

		expect(result).toEqual({ kind: "create", title: "My New Note" });
	});
});
