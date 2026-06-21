import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { formatFileNameMock, formatFileContentMock } = vi.hoisted(() => ({
	formatFileNameMock: vi.fn<(format: string, prompt: string) => Promise<string>>(),
	formatFileContentMock: vi
		.fn<(...args: unknown[]) => Promise<string>>()
		.mockResolvedValue(""),
}));

vi.mock("../formatters/completeFormatter", () => {
	class CompleteFormatterMock {
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		setTargetFolderPath() {}
		async formatFileName(format: string, prompt: string) {
			return formatFileNameMock(format, prompt);
		}
		async formatFileContent(...args: unknown[]) {
			return await formatFileContentMock(...args);
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

const { insertFileLinkToActiveViewMock } = vi.hoisted(() => ({
	insertFileLinkToActiveViewMock: vi.fn(),
}));

vi.mock("../utils/fileLinks", () => ({
	appendFileLinkToDestinationFile: vi.fn(),
	copyFileLinkToClipboard: vi.fn(),
	getAppendLinkDestinationFile: vi.fn(() => null),
}));

vi.mock("../utilityObsidian", () => ({
	getTemplater: vi.fn(() => ({})),
	overwriteTemplaterOnce: vi.fn(),
	getAllFolderPathsInVault: vi.fn(() => []),
	insertFileLinkToActiveView: insertFileLinkToActiveViewMock,
	openExistingFileTab: vi.fn(() => null),
	openFile: vi.fn(),
	jumpToNextTemplaterCursorIfPossible: vi.fn(),
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: { Suggest: vi.fn() },
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
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
		expect(choiceExecutor.recordExecutionResult).toHaveBeenCalledWith({
			status: "success",
			file: createdFile,
		});
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

describe("TemplateChoiceEngine create-another collision feedback (audit)", () => {
	it("notices the renamed file when a create-another collision occurs and the file is not opened", async () => {
		const { engine, app } = createEngine();
		const createdFile = makeTFile("Plan (1).md");

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
		expect(
			noticeClass.instances.some((instance) =>
				instance.message.includes("Created 'Plan (1)'"),
			),
		).toBe(true);
	});
});
