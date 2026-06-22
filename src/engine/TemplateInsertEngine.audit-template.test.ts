import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../formatters/completeFormatter", () => {
	class CompleteFormatterMock {
		targetFolderPath: string | null = null;
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		setTargetFolderPath(path: string | null) {
			this.targetFolderPath = path;
		}
		async formatFileContent(input: string) {
			return input;
		}
		async formatFileName(format: string) {
			return format;
		}
		async formatFolderPath(folder: string) {
			return folder;
		}
		async formatTemplateFilePath(input: string) {
			return input;
		}
		async withTemplatePropertyCollection<T>(work: () => Promise<T>) {
			return await work();
		}
		getAndClearTemplatePropertyVars() {
			return new Map<string, unknown>();
		}
	}

	return { CompleteFormatter: CompleteFormatterMock };
});

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

vi.mock("../utilityObsidian", async (importOriginal) => {
	const actual = await importOriginal<object>();
	return {
		...actual,
		getTemplater: vi.fn(() => ({})),
		overwriteTemplaterOnce: vi.fn(),
		templaterParseTemplate: vi.fn(
			async (_app: unknown, content: string) => content,
		),
	};
});

import { TFile, type App } from "obsidian";
import type QuickAdd from "../main";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { TemplateInsertEngine } from "./TemplateInsertEngine";

const TEMPLATE_PATH = "templates/tpl.md";

function makeFile(overrides: Partial<TFile> = {}): TFile {
	const file = new TFile();
	file.path = "notes/My note.md";
	file.basename = "My note";
	file.extension = "md";
	Object.assign(file, overrides);
	return file;
}

function makeTemplateChoice(
	overrides: Partial<ITemplateChoice> = {},
): ITemplateChoice {
	return {
		name: "Meeting note",
		id: "choice-id",
		type: "Template",
		command: false,
		templatePath: TEMPLATE_PATH,
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		fileNameFormat: { enabled: false, format: "" },
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "source",
			focus: false,
		},
		fileExistsBehavior: { kind: "prompt" },
		...overrides,
	};
}

function makeApp(): App {
	return {
		vault: {
			getAbstractFileByPath: () => null,
		},
	} as unknown as App;
}

function makeEngine(file: TFile): TemplateInsertEngine {
	return new TemplateInsertEngine(
		makeApp(),
		{} as QuickAdd,
		file,
		TEMPLATE_PATH,
		"replace",
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("computeChoiceTargetPath — stale chooseFromSubfolders gating (audit)", () => {
	it("still computes a target for active-file mode with a leftover chooseFromSubfolders flag", async () => {
		// applyFolderMode preserves chooseFromSubfolders across mode switches, so an
		// active-file-mode choice can carry chooseFromSubfolders=true. The engine
		// ignores that flag outside specified mode, so the move offer must still be
		// computed (next to the active file) rather than suppressed.
		const file = makeFile({ parent: { path: "Daily" } as TFile["parent"] });
		const choice = makeTemplateChoice({
			folder: {
				enabled: true,
				folders: ["Templates/Roots"],
				chooseWhenCreatingNote: false,
				createInSameFolderAsActiveFile: true,
				chooseFromSubfolders: true,
			},
			fileNameFormat: { enabled: true, format: "Renamed" },
		});

		const target = await makeEngine(file).computeChoiceTargetPath(choice);

		expect(target).toBe("Daily/Renamed.md");
	});

	it("still suppresses the target in specified mode with chooseFromSubfolders set", async () => {
		// In specified mode chooseFromSubfolders genuinely needs a runtime picker,
		// so the move offer must remain suppressed (null).
		const file = makeFile({ parent: { path: "Daily" } as TFile["parent"] });
		const choice = makeTemplateChoice({
			folder: {
				enabled: true,
				folders: ["Projects"],
				chooseWhenCreatingNote: false,
				createInSameFolderAsActiveFile: false,
				chooseFromSubfolders: true,
			},
			fileNameFormat: { enabled: true, format: "Renamed" },
		});

		const target = await makeEngine(file).computeChoiceTargetPath(choice);

		expect(target).toBeNull();
	});
});
