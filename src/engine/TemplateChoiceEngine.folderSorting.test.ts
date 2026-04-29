import { beforeEach, describe, expect, it, vi } from "vitest";

const { inputSuggestMock } = vi.hoisted(() => ({
	inputSuggestMock: vi.fn(),
}));

vi.mock("../gui/InputSuggester/inputSuggester", () => ({
	default: {
		Suggest: inputSuggestMock,
	},
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: {
		Suggest: vi.fn(),
	},
}));

vi.mock("../formatters/completeFormatter", () => ({
	CompleteFormatter: class {
		setLinkToCurrentFileBehavior() {}
		async formatFolderPath(folderPath: string): Promise<string> {
			return folderPath;
		}
		async formatFileName(): Promise<string> {
			throw new Error("Stop test after folder selection");
		}
	},
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

import { TFile, TFolder, type App } from "obsidian";
import { TemplateChoiceEngine } from "./TemplateChoiceEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ITemplateChoice from "../types/choices/ITemplateChoice";

function createFolder(path: string): TFolder {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path.split("/").pop() ?? path;
	return folder;
}

function createActiveFile(parentPath: string): TFile {
	const file = new TFile();
	file.path = `${parentPath}/Active.md`;
	file.name = "Active.md";
	file.basename = "Active";
	file.extension = "md";
	file.parent = createFolder(parentPath) as never;
	return file;
}

function createChoice(
	folder: Partial<ITemplateChoice["folder"]>,
): ITemplateChoice {
	return {
		name: "Folder Sort Test",
		id: "folder-sort-test",
		type: "Template",
		command: false,
		templatePath: "Templates/Test.md",
		folder: {
			enabled: true,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
			...folder,
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
	};
}

function createEngine(
	choice: ITemplateChoice,
	folders: string[],
	activeFile: TFile | null = null,
) {
	const app = {
		plugins: {
			plugins: {},
		},
		workspace: {
			getActiveFile: vi.fn(() => activeFile),
		},
		vault: {
			getAllLoadedFiles: vi.fn(() => folders.map(createFolder)),
			adapter: {
				exists: vi.fn(async () => false),
			},
			createFolder: vi.fn(),
		},
	} as unknown as App;

	const plugin = {
		settings: {
			globalVariables: {},
		},
	} as any;
	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
	};

	return new TemplateChoiceEngine(app, plugin, choice, choiceExecutor);
}

function getSuggestedItems(): string[] {
	return inputSuggestMock.mock.calls[0]?.[2] as string[];
}

describe("TemplateChoiceEngine folder suggestions", () => {
	beforeEach(() => {
		inputSuggestMock.mockReset();
		inputSuggestMock.mockImplementation(
			async (
				_app: App,
				_displayItems: string[],
				items: string[],
			): Promise<string> => items[0],
		);
	});

	it("shows included subfolders in path-tree order", async () => {
		const engine = createEngine(
			createChoice({
				folders: ["A"],
				chooseFromSubfolders: true,
			}),
			[
				"A/B2/C1",
				"A/B1",
				"A/B3/C2",
				"A/B3",
				"A/B1/C2",
				"A",
				"A/B2",
				"A/B1/C1",
				"A/B3/C1",
				"A2/B1",
				"B/B1",
			],
		);

		await engine.run();

		expect(inputSuggestMock).toHaveBeenCalledTimes(1);
		expect(getSuggestedItems()).toEqual([
			"A",
			"A/B1",
			"A/B1/C1",
			"A/B1/C2",
			"A/B2",
			"A/B2/C1",
			"A/B3",
			"A/B3/C1",
			"A/B3/C2",
		]);
	});

	it("keeps the current-folder suggestion before sorted vault folders", async () => {
		const engine = createEngine(
			createChoice({
				chooseWhenCreatingNote: true,
			}),
			["A/B2", "A", "A/B1"],
			createActiveFile("Current"),
		);

		await engine.run();

		expect(inputSuggestMock).toHaveBeenCalledTimes(1);
		expect(getSuggestedItems()).toEqual([
			"Current",
			"A",
			"A/B1",
			"A/B2",
		]);
	});
});
