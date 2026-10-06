import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/templateFolderUtils", async (importOriginal) =>
	(await import("../../tests/helpers/engines/everyTemplateExists")).everyTemplateExists(importOriginal));

vi.mock("../quickAddSettingsTab", () => {
	const defaultSettings = {
		choices: [],
		inputPrompt: "single-line",
		devMode: false,
		templateFolderPaths: [],
		useSelectionAsCaptureValue: true,
		announceUpdates: "major",
		version: "0.0.0",
		globalVariables: {},
		onePageInputEnabled: false,
		disableOnlineFeatures: true,
		enableRibbonIcon: false,
		showCaptureNotification: true,
		showInputCancellationNotification: true,
		enableTemplatePropertyTypes: false,
		ai: {
			defaultModel: "Ask me",
			defaultSystemPrompt: "",
			promptTemplatesFolderPath: "",
			showAssistant: true,
			providers: [],
		},
		migrations: {},
	};

	return {
		DEFAULT_SETTINGS: defaultSettings,
		QuickAddSettingsTab: class {},
	};
});

const { formatFileNameMock, formatFileContentMock, setPromptRunContextMock } =
	vi.hoisted(() => ({
	setPromptRunContextMock: vi.fn<(context: unknown) => void>(),
	formatFileNameMock: vi.fn<(format: string, prompt: string) => Promise<string>>(),
	formatFileContentMock: vi
		.fn<(...args: unknown[]) => Promise<string>>()
		.mockResolvedValue(""),
}));

vi.mock("../formatters/completeFormatter", () => {
	class CompleteFormatterMock {
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		setPromptRunContext(context: unknown) {
			setPromptRunContextMock(context);
		}
		setTargetFolderPath() {}
		async formatFileName(format: string, prompt: string) {
			return formatFileNameMock(format, prompt);
		}
		async formatTemplateContent(input: string) {
			return await this.formatFileContent(input);
		}
		async formatFileContent(...args: unknown[]) {
			return await formatFileContentMock(...args);
		}
		async formatTemplateFilePath(input: string) {
			return input;
		}
		async formatFolderPath(folder: string) {
			return folder;
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

const { insertFileLinkToActiveViewMock } = vi.hoisted(() => ({
	insertFileLinkToActiveViewMock: vi.fn(),
}));

vi.mock("../utils/fileLinks", () => ({
	appendFileLinkToDestinationFile: vi.fn(),
	copyFileLinkToClipboard: vi.fn(),
	getAppendLinkDestinationFile: vi.fn(() => null),
}));

vi.mock("../utils/templaterIntegration", () => ({
	getTemplater: vi.fn(() => ({})),
	overwriteTemplaterOnce: vi.fn(),
	jumpToNextTemplaterCursorIfPossible: vi.fn(),
}));
vi.mock("../utils/vaultQueries", () => ({
	getAllFolderPathsInVault: vi.fn(() => []),
}));
vi.mock("../utils/editorInsertion", () => ({
	insertFileLinkToActiveView: insertFileLinkToActiveViewMock,
}));
vi.mock("../utils/fileOpening", () => ({
	openExistingFileTab: vi.fn(() => null),
	openFile: vi.fn(),
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: { Suggest: vi.fn() },
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

import { Notice, TFile, type App } from "obsidian";
import { TemplateChoiceEngine } from "./TemplateChoiceEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { settingsStore } from "../settingsStore";
import { InputPromptDraftStore } from "../utils/InputPromptDraftStore";
import { log } from "../logger/logManager";

const defaultSettingsState = structuredClone(settingsStore.getState());

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string; timeout?: number }>;
};
const noticeClass = Notice as unknown as NoticeTestClass;

function createTemplateChoice(): ITemplateChoice {
	return {
		name: "Test Template Choice",
		id: "choice-id",
		type: "Template",
		command: false,
		templatePath: "Templates/Test.md",
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
	};
}

function createEngine() {
	const app = {
		workspace: {
			getActiveFile: vi.fn(() => null),
		},
		fileManager: {
			getNewFileParent: vi.fn(() => ({ path: "" })),
		},
		vault: {
			getRoot: vi.fn(() => ({ path: "" })),
			read: vi.fn(async () => ""),
			adapter: {
				exists: vi.fn(async () => false),
			},
			getAbstractFileByPath: vi.fn(),
			getFiles: vi.fn(() => []),
			createFolder: vi.fn(),
			create: vi.fn(),
			modify: vi.fn(),
		},
	} as unknown as App;

	const plugin = { settings: settingsStore.getState() } as never;
	const choiceExecutor: IChoiceExecutor = {
		...createChoiceExecutor(),
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
		signalAbort: vi.fn(),
		consumeAbortSignal: vi.fn(),
		recordExecutionResult: vi.fn(),
	} as unknown as IChoiceExecutor;

	const engine = new TemplateChoiceEngine(
		app,
		plugin,
		createTemplateChoice(),
		choiceExecutor,
	);

	formatFileNameMock.mockResolvedValue("Test Template");

	return { engine, choiceExecutor, app };
}

function makeTFile(path: string, extension = "md"): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.basename = file.name.replace(/\.(md|canvas|base)$/i, "");
	file.extension = extension;
	return file;
}

beforeEach(() => {
	settingsStore.setState(structuredClone(defaultSettingsState));
	noticeClass.instances.length = 0;
	InputPromptDraftStore.getInstance().clearAll();
	formatFileNameMock.mockReset();
	formatFileContentMock.mockReset();
	formatFileContentMock.mockResolvedValue("");
	insertFileLinkToActiveViewMock.mockReset();
});

describe("TemplateChoiceEngine post-commit link failure (audit)", () => {
	it("does not report a fatal error when strict append-link fails after the note was created", async () => {
		const { engine, choiceExecutor } = createEngine();
		const createdFile = makeTFile("Test Template.md");

		engine.choice.appendLink = {
			enabled: true,
			placement: "replaceSelection",
			requireActiveFile: true,
			linkType: "link",
			destination: { type: "activeFile" },
		};
		(
			engine as unknown as {
				createFileWithTemplate: () => Promise<TFile | null>;
			}
		).createFileWithTemplate = vi.fn().mockResolvedValue(createdFile);
		insertFileLinkToActiveViewMock.mockRejectedValueOnce(
			new Error("Cannot append link because no active Markdown view is available."),
		);
		const logErrorSpy = vi.spyOn(log, "logError").mockImplementation(() => "");
		const logWarningSpy = vi
			.spyOn(log, "logWarning")
			.mockImplementation(() => "");

		await engine.run();

		// Success is still recorded for the created note.
		expect(choiceExecutor.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({
			status: "success",
			file: createdFile,
			effect: "created",
		}));
		// The link failure surfaces as a warning that names the created file, not
		// a fatal "Error running template choice".
		expect(
			logErrorSpy.mock.calls.some((call) =>
				String(call[0]).includes("Error running template choice"),
			),
		).toBe(false);
		expect(
			logWarningSpy.mock.calls.some((call) =>
				String(call[0]).includes(
					"Created 'Test Template' but could not insert the link",
				),
			),
		).toBe(true);
	});
});

describe("TemplateChoiceEngine Undo snapshot after its link (audit)", () => {
	it("records, as what the run left, the note after its link went into it as well", async () => {
		const { engine, choiceExecutor, app } = createEngine();
		const createdFile = makeTFile("Test Template.md");
		vi.mocked(app.vault.read).mockImplementation(async (file) => file === createdFile ? "# Plan\n" : "");
		vi.mocked(app.workspace.getActiveFile).mockReturnValue(createdFile);
		engine.choice.openFile = false;
		engine.choice.appendLink = {
			enabled: true, placement: "newLine", requireActiveFile: false, linkType: "link", destination: { type: "activeFile" },
		};
		(engine as unknown as { createFileWithTemplate: () => Promise<TFile | null> }).createFileWithTemplate =
			vi.fn().mockResolvedValue(createdFile);
		insertFileLinkToActiveViewMock.mockImplementationOnce(async () => {
			vi.mocked(app.vault.read).mockImplementation(async (file) => file === createdFile ? "# Plan\n[[Test Template]]\n" : "");
		});

		await engine.run();

		expect(choiceExecutor.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({
			write: { path: "Test Template.md", before: null, after: "# Plan\n[[Test Template]]\n" },
		}));
	});
});

describe("TemplateChoiceEngine create-another collision feedback (audit)", () => {
	it("reports the renamed file, and what it holds for Undo, when a create-another collision occurs", async () => {
		const { engine, app, choiceExecutor } = createEngine();
		const createdFile = makeTFile("Plan (1).md");
		vi.mocked(app.vault.read).mockImplementation(async (file) => file === createdFile ? "# Plan\n" : "");

		engine.choice.openFile = false;
		engine.choice.fileExistsBehavior = {
			kind: "apply",
			mode: "duplicateSuffix",
		};
		formatFileNameMock.mockResolvedValueOnce("Plan");
		// The target "Plan.md" already exists; "Plan (1).md" does not.
		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "Plan.md",
		);
		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						path: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createdFile);

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"Plan (1).md",
			engine.choice.templatePath,
		);
		expect(choiceExecutor.recordExecutionResult).toHaveBeenCalledWith({
			status: "success",
			file: createdFile,
			effect: "created",
			write: { path: "Plan (1).md", before: null, after: "# Plan\n" },
		});
	});

	// issue #1546: the prompt context line must never promise a folder the answer
	// itself can reroute.
	it("advertises the folder to the title prompt only when a folder is configured", async () => {
		const { engine } = createEngine();
		engine.choice.folder = {
			enabled: true,
			folders: ["Books"],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		};
		setPromptRunContextMock.mockClear();

		await engine.run();

		expect(setPromptRunContextMock).toHaveBeenCalledWith({
			destination: "Books",
			destinationKind: "folder",
		});
	});

	it("withholds the folder when folder settings are off", async () => {
		// Without a configured folder the formatted name can route the note from
		// the vault root instead of Obsidian's default location, and the answer
		// that reroutes it is the one being typed.
		const { engine } = createEngine();
		engine.choice.folder.enabled = false;
		setPromptRunContextMock.mockClear();

		await engine.run();

		expect(setPromptRunContextMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ destinationKind: "folder" }),
		);
	});
});
