import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../quickAddSettingsTab", () => {
	const defaultSettings = {
		choices: [],
		inputPrompt: "single-line",
		devMode: false,
		templateFolderPath: "",
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
		migrations: {
			migrateToMacroIDFromEmbeddedMacro: true,
			useQuickAddTemplateFolder: false,
			incrementFileNameSettingMoveToDefaultBehavior: false,
			mutualExclusionInsertAfterAndWriteToBottomOfFile: false,
			setVersionAfterUpdateModalRelease: false,
			addDefaultAIProviders: false,
			removeMacroIndirection: false,
			migrateFileOpeningSettings: false,
			backfillFileOpeningDefaults: false,
		},
	};

	return {
		DEFAULT_SETTINGS: defaultSettings,
		QuickAddSettingsTab: class {},
	};
});

const { formatFileNameMock, formatFileContentMock } = vi.hoisted(() => {
	const formatName = vi.fn<(format: string, prompt: string) => Promise<string>>();
	const formatContent = vi
		.fn<(...args: unknown[]) => Promise<string>>()
		.mockResolvedValue("");

	return {
		formatFileNameMock: formatName,
		formatFileContentMock: formatContent,
	};
});

vi.mock("../formatters/completeFormatter", () => {
	class CompleteFormatterMock {
		constructor() {}
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		async formatFileName(format: string, prompt: string) {
			return formatFileNameMock(format, prompt);
		}
		async formatFileContent(...args: unknown[]) {
			return await formatFileContentMock(...args);
		}
		getAndClearTemplatePropertyVars() {
			return new Map<string, unknown>();
		}
	}

	return {
		CompleteFormatter: CompleteFormatterMock,
		formatFileNameMock,
		formatFileContentMock,
	};
});

	vi.mock("../utilityObsidian", () => ({
		getTemplater: vi.fn(() => ({})),
		overwriteTemplaterOnce: vi.fn(),
		getAllFolderPathsInVault: vi.fn(async () => []),
		insertFileLinkToActiveView: vi.fn(),
		openExistingFileTab: vi.fn(() => null),
		openFile: vi.fn(),
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
import { Notice } from "obsidian";
import { TemplateChoiceEngine } from "./TemplateChoiceEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { MacroAbortError } from "../errors/MacroAbortError";
import { settingsStore } from "../settingsStore";
import { fileExistsAppendToBottom, fileExistsOverwriteFile } from "../constants";

const defaultSettingsState = structuredClone(settingsStore.getState());

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string; timeout?: number }>;
};

const noticeClass = Notice as unknown as NoticeTestClass;

const createTemplateChoice = (): ITemplateChoice => ({
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
	fileExistsMode: fileExistsAppendToBottom,
	setFileExistsBehavior: false,
});

const createEngine = (
	abortMessage: string,
	options: { throwDuringFileName?: boolean; stubTemplateContent?: boolean } = {},
) => {
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

	const plugin = { settings: settingsStore.getState() } as any;
	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
		signalAbort: vi.fn(),
		consumeAbortSignal: vi.fn(),
	};

	const engine = new TemplateChoiceEngine(
		app,
		plugin,
		createTemplateChoice(),
		choiceExecutor,
	);

	if (options.stubTemplateContent) {
		(
			engine as unknown as {
				getTemplateContent: () => Promise<string>;
			}
		).getTemplateContent = vi.fn().mockResolvedValue("stub template");
	}

	if (options.throwDuringFileName !== false) {
		formatFileNameMock.mockImplementation(async () => {
			throw new MacroAbortError(abortMessage);
		});
	} else {
		formatFileNameMock.mockResolvedValue("Test Template");
	}

	return { engine, choiceExecutor, app };
};

describe("TemplateChoiceEngine cancellation notices", () => {
	beforeEach(() => {
		settingsStore.setState(structuredClone(defaultSettingsState));
		noticeClass.instances.length = 0;
		formatFileNameMock.mockReset();
		formatFileContentMock.mockReset();
		formatFileContentMock.mockResolvedValue("");
	});

	it("shows a cancellation notice when the setting is enabled", async () => {
		settingsStore.setState({
			...settingsStore.getState(),
			showInputCancellationNotification: true,
		});
		const { engine } = createEngine("Input cancelled by user");

		await engine.run();

		expect(noticeClass.instances).toHaveLength(1);
		expect(noticeClass.instances[0]?.message).toContain(
			"Template execution aborted: Input cancelled by user",
		);
	});

	it("suppresses cancellation notices when the setting is disabled", async () => {
		settingsStore.setState({
			...settingsStore.getState(),
			showInputCancellationNotification: false,
		});

		const { engine } = createEngine("Input cancelled by user");

		await engine.run();

		expect(noticeClass.instances).toHaveLength(0);
	});

	it("still shows notices for other abort reasons", async () => {
		settingsStore.setState({
			...settingsStore.getState(),
			showInputCancellationNotification: false,
		});

		const { engine } = createEngine("Missing template");

		await engine.run();

		expect(noticeClass.instances).toHaveLength(1);
		expect(noticeClass.instances[0]?.message).toContain(
			"Template execution aborted: Missing template",
		);
	});

	it("signals abort back to the choice executor", async () => {
		const { engine, choiceExecutor } = createEngine("Input cancelled by user");

		await engine.run();

		expect(choiceExecutor.signalAbort).toHaveBeenCalledTimes(1);
		const [[error]] = (choiceExecutor.signalAbort as ReturnType<typeof vi.fn>).mock.calls;
		expect(error).toBeInstanceOf(MacroAbortError);
	});

	it("signals abort when template content formatting is cancelled", async () => {
		const { engine, choiceExecutor } = createEngine("ignored", {
			throwDuringFileName: false,
			stubTemplateContent: true,
		});
		formatFileContentMock.mockRejectedValueOnce(
			new MacroAbortError("Input cancelled by user"),
		);

		await engine.run();

		expect(choiceExecutor.signalAbort).toHaveBeenCalledTimes(1);
	});
});

describe("TemplateChoiceEngine file casing resolution", () => {
	beforeEach(() => {
		settingsStore.setState(structuredClone(defaultSettingsState));
		formatFileNameMock.mockReset();
		formatFileContentMock.mockReset();
		formatFileContentMock.mockResolvedValue("");
	});

	it("overwrites existing files when the path casing differs", async () => {
		const { engine, app } = createEngine("ignored", {
			throwDuringFileName: false,
			stubTemplateContent: true,
		});

		const existingFile = new TFile();
		existingFile.path = "Bug report.md";
		existingFile.name = "Bug report.md";
		existingFile.extension = "md";
		existingFile.basename = "Bug report";

		engine.choice.fileExistsMode = fileExistsOverwriteFile;
		engine.choice.setFileExistsBehavior = true;
		formatFileNameMock.mockResolvedValueOnce("Bug Report");

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(
			true,
		);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			null,
		);
		(app.vault.getFiles as ReturnType<typeof vi.fn>).mockReturnValue([
			existingFile,
		]);

		const overwriteSpy = vi
			.spyOn(
				engine as unknown as {
					overwriteFileWithTemplate: (
						file: TFile,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"overwriteFileWithTemplate",
			)
			.mockResolvedValue(existingFile);

		await engine.run();

		expect(overwriteSpy).toHaveBeenCalledWith(
			existingFile,
			engine.choice.templatePath,
		);
	});
});

describe("TemplateChoiceEngine destination path resolution", () => {
	beforeEach(() => {
		settingsStore.setState(structuredClone(defaultSettingsState));
		formatFileNameMock.mockReset();
		formatFileContentMock.mockReset();
		formatFileContentMock.mockResolvedValue("");
	});

	it("treats slash-separated filename formats as vault-relative paths when the first segment exists", async () => {
		const { engine, app } = createEngine("ignored", {
			throwDuringFileName: false,
			stubTemplateContent: true,
		});
		const createdFile = new TFile();
		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						filePath: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createdFile);

		engine.choice.folder.enabled = false;
		engine.choice.fileNameFormat.enabled = true;
		engine.choice.fileNameFormat.format = "{{VALUE:path}}";

		formatFileNameMock.mockResolvedValueOnce(
			"03_Aufgabenmanagement/ToDos/Issue1116",
		);
		(app.fileManager.getNewFileParent as ReturnType<typeof vi.fn>).mockReturnValue({
			path: "03_Aufgabenmanagement/ToDos/W-Tanso",
		});
		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "03_Aufgabenmanagement",
		);

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"03_Aufgabenmanagement/ToDos/Issue1116.md",
			engine.choice.templatePath,
		);
	});

	it("keeps Obsidian default location behavior for plain file names", async () => {
		const { engine, app } = createEngine("ignored", {
			throwDuringFileName: false,
			stubTemplateContent: true,
		});
		const createdFile = new TFile();
		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						filePath: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createdFile);

		engine.choice.folder.enabled = false;
		engine.choice.fileNameFormat.enabled = true;
		engine.choice.fileNameFormat.format = "{{VALUE:name}}";

		formatFileNameMock.mockResolvedValueOnce("Issue1116");
		(app.fileManager.getNewFileParent as ReturnType<typeof vi.fn>).mockReturnValue({
			path: "03_Aufgabenmanagement/ToDos/W-Tanso",
		});
		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"03_Aufgabenmanagement/ToDos/W-Tanso/Issue1116.md",
			engine.choice.templatePath,
		);
	});

	it("keeps relative subpaths under the default location when the first segment does not exist at vault root", async () => {
		const { engine, app } = createEngine("ignored", {
			throwDuringFileName: false,
			stubTemplateContent: true,
		});
		const createdFile = new TFile();
		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						filePath: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createdFile);

		engine.choice.folder.enabled = false;
		engine.choice.fileNameFormat.enabled = true;
		engine.choice.fileNameFormat.format = "{{VALUE:path}}";

		formatFileNameMock.mockResolvedValueOnce("tasks/Issue1116");
		(app.fileManager.getNewFileParent as ReturnType<typeof vi.fn>).mockReturnValue({
			path: "03_Aufgabenmanagement/ToDos/W-Tanso",
		});
		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async () => false,
		);

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"03_Aufgabenmanagement/ToDos/W-Tanso/tasks/Issue1116.md",
			engine.choice.templatePath,
		);
	});
});
