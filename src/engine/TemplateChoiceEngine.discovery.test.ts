import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	formatFileNameMock,
	formatFileContentMock,
	promptForTemplateNoteDiscoveryMock,
	openExistingFileTabMock,
	openFileMock,
	insertFileLinkMock,
	copyFileLinkMock,
} = vi.hoisted(() => ({
	formatFileNameMock: vi.fn<(format: string, prompt: string) => Promise<string>>(),
	formatFileContentMock: vi.fn<() => Promise<string>>(),
	promptForTemplateNoteDiscoveryMock: vi.fn(),
	openExistingFileTabMock: vi.fn(),
	openFileMock: vi.fn(),
	insertFileLinkMock: vi.fn(),
	copyFileLinkMock: vi.fn(),
}));

vi.mock("../formatters/completeFormatter", () => {
	class CompleteFormatterMock {
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		setTargetFolderPath() {}
		async formatFileName(format: string, prompt: string) {
			return formatFileNameMock(format, prompt);
		}
		async formatFileContent() {
			return await formatFileContentMock();
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

vi.mock("./templateNoteDiscovery", async () => {
	const actual = await vi.importActual("./templateNoteDiscovery");
	return {
		...(actual as Record<string, unknown>),
		promptForTemplateNoteDiscovery: promptForTemplateNoteDiscoveryMock,
	};
});

vi.mock("../utilityObsidian", () => ({
	getTemplater: vi.fn(() => ({})),
	overwriteTemplaterOnce: vi.fn(),
	getAllFolderPathsInVault: vi.fn(() => []),
	insertFileLinkToActiveView: insertFileLinkMock,
	openExistingFileTab: openExistingFileTabMock,
	openFile: openFileMock,
}));

vi.mock("../utils/fileLinks", () => ({
	copyFileLinkToClipboard: copyFileLinkMock,
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: {
		Suggest: vi.fn(),
	},
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

import { TFile, type App } from "obsidian";
import { TemplateChoiceEngine } from "./TemplateChoiceEngine";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";

function file(path: string): TFile {
	const tfile = new TFile();
	tfile.path = path;
	tfile.name = path.split("/").pop() ?? path;
	tfile.basename = tfile.name.replace(/\.(md|canvas|base)$/i, "");
	tfile.extension = tfile.name.split(".").pop() ?? "md";
	tfile.stat = { ctime: 0, mtime: 0, size: 0 };
	return tfile;
}

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
		copyLinkToClipboard: false,
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

function buildEngine(
	templateChoice = choice(),
	variables = new Map<string, unknown>(),
) {
	const created = file("Created.md");
	const app = {
		workspace: {
			getActiveFile: vi.fn(() => null),
		},
		fileManager: {
			getNewFileParent: vi.fn(() => ({ path: "" })),
		},
		vault: {
			getRoot: vi.fn(() => ({ path: "" })),
			adapter: {
				exists: vi.fn(async () => false),
			},
			getAbstractFileByPath: vi.fn(() => null),
			getFiles: vi.fn(() => []),
			createFolder: vi.fn(),
			create: vi.fn(async () => created),
			modify: vi.fn(),
		},
	} as unknown as App;
	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables,
		recordExecutionResult: vi.fn(),
		signalAbort: vi.fn(),
		consumeAbortSignal: vi.fn(),
	};
	const plugin = { settings: { globalVariables: {} } } as never;
	const engine = new TemplateChoiceEngine(
		app,
		plugin,
		templateChoice,
		choiceExecutor,
	);
	return { engine, app, choiceExecutor, created };
}

describe("TemplateChoiceEngine note discovery", () => {
	beforeEach(() => {
		formatFileNameMock.mockReset();
		formatFileNameMock.mockResolvedValue("Created");
		formatFileContentMock.mockReset();
		formatFileContentMock.mockResolvedValue("");
		promptForTemplateNoteDiscoveryMock.mockReset();
		openExistingFileTabMock.mockReset();
		openExistingFileTabMock.mockReturnValue(null);
		openFileMock.mockReset();
		insertFileLinkMock.mockReset();
		copyFileLinkMock.mockReset();
	});

	it("opens an existing discovery result unchanged and skips template side effects", async () => {
		const existing = file("People/Alice.md");
		promptForTemplateNoteDiscoveryMock.mockResolvedValue({
			kind: "openExisting",
			file: existing,
		});
		const { engine, app, choiceExecutor } = buildEngine(
			choice({
				appendLink: true,
				copyLinkToClipboard: true,
				fileExistsBehavior: { kind: "apply", mode: "overwrite" },
			}),
		);
		const createSpy = vi.spyOn(
			engine as unknown as {
				createFileWithTemplate: (path: string, template: string) => Promise<TFile | null>;
			},
			"createFileWithTemplate",
		);
		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);

		await engine.run();

		expect(formatFileNameMock).not.toHaveBeenCalled();
		expect(createSpy).not.toHaveBeenCalled();
		expect(insertFileLinkMock).not.toHaveBeenCalled();
		expect(copyFileLinkMock).not.toHaveBeenCalled();
		expect(openFileMock).toHaveBeenCalledWith(
			expect.anything(),
			existing,
			expect.objectContaining({ focus: true }),
		);
		expect(choiceExecutor.recordExecutionResult).toHaveBeenCalledWith({
			status: "success",
			file: existing,
		});
	});

	it("seeds VALUE and continues through normal template creation for create rows", async () => {
		promptForTemplateNoteDiscoveryMock.mockResolvedValue({
			kind: "create",
			title: "Brand New Project",
		});
		const { engine, choiceExecutor, created } = buildEngine();
		formatFileNameMock.mockImplementation(async () => {
			expect(choiceExecutor.variables.get("value")).toBe("Brand New Project");
			return "Brand New Project";
		});
		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						path: string,
						template: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(created);

		await engine.run();

		expect(choiceExecutor.variables.has("value")).toBe(false);
		expect(formatFileNameMock).toHaveBeenCalledWith("{{value}}", "Project note");
		expect(createSpy).toHaveBeenCalledWith(
			"Brand New Project.md",
			"Templates/Project.md",
		);
	});

	it("honors foldered unresolved-link targets as vault-relative paths", async () => {
		promptForTemplateNoteDiscoveryMock.mockResolvedValue({
			kind: "create",
			title: "Projects/Missing Roadmap",
			vaultRelativePath: "Projects/Missing Roadmap",
		});
		const { engine, choiceExecutor, created } = buildEngine(
			choice({
				folder: {
					enabled: true,
					folders: ["Inbox"],
					chooseWhenCreatingNote: false,
					createInSameFolderAsActiveFile: false,
					chooseFromSubfolders: false,
				},
			}),
		);
		formatFileNameMock.mockImplementation(async () => {
			expect(choiceExecutor.variables.get("value")).toBe(
				"Projects/Missing Roadmap",
			);
			return "Projects/Missing Roadmap";
		});
		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						path: string,
						template: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(created);

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"Projects/Missing Roadmap.md",
			"Templates/Project.md",
		);
		expect(formatFileNameMock).not.toHaveBeenCalled();
		expect(choiceExecutor.variables.has("value")).toBe(false);
	});

	it("skips discovery when VALUE was already supplied by CLI, URI, or preflight", async () => {
		const { engine } = buildEngine(choice(), new Map([["value", "Seeded"]]));

		await engine.run();

		expect(promptForTemplateNoteDiscoveryMock).not.toHaveBeenCalled();
		expect(formatFileNameMock).toHaveBeenCalled();
	});

	it("requires explicit opt-in for persisted Template choices", async () => {
		const { engine } = buildEngine(
			choice({ discoverExistingNotesBeforeCreate: false }),
		);

		await engine.run();

		expect(promptForTemplateNoteDiscoveryMock).not.toHaveBeenCalled();
	});

	it("does not run for non-default file name formats", async () => {
		const { engine } = buildEngine(
			choice({
				fileNameFormat: { enabled: true, format: "Project {{VALUE}}" },
			}),
		);

		await engine.run();

		expect(promptForTemplateNoteDiscoveryMock).not.toHaveBeenCalled();
	});
});
