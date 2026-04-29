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
			consolidateFileExistsBehavior: false,
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
	getAllFolderPathsInVault: vi.fn(() => []),
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

import { TFile, TFolder, type App } from "obsidian";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { settingsStore } from "../settingsStore";
import { getPromptModes } from "../template/fileExistsPolicy";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { TemplateChoiceEngine } from "./TemplateChoiceEngine";

const defaultSettingsState = structuredClone(settingsStore.getState());

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
	fileExistsBehavior: { kind: "prompt" },
});

const createExistingFile = (path: string) => {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.extension = "md";
	file.basename = file.name.replace(/\.md$/, "");
	return file;
};

const createExistingFolder = (path: string) => {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path.split("/").pop() ?? path;
	return folder;
};

const createEngine = () => {
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

	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
		signalAbort: vi.fn(),
		consumeAbortSignal: vi.fn(),
	};

	const engine = new TemplateChoiceEngine(
		app,
		{ settings: settingsStore.getState() } as any,
		createTemplateChoice(),
		choiceExecutor,
	);

	formatFileNameMock.mockResolvedValue("Test Template");
	formatFileContentMock.mockResolvedValue("");

	return { app, engine };
};

describe("TemplateChoiceEngine collision behavior", () => {
	beforeEach(() => {
		settingsStore.setState(structuredClone(defaultSettingsState));
		formatFileNameMock.mockReset();
		formatFileContentMock.mockReset();
		vi.mocked(GenericSuggester.Suggest).mockReset();
	});

	it("prompts before applying increment mode when auto behavior is off", async () => {
		const { app, engine } = createEngine();
		const existingFile = createExistingFile("Test Template.md");

		engine.choice.fileExistsBehavior = { kind: "prompt" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue("doNothing");
		const createSpy = vi.spyOn(
			engine as unknown as {
				createFileWithTemplate: (
					filePath: string,
					templatePath: string,
				) => Promise<TFile | null>;
			},
			"createFileWithTemplate",
		);

		await engine.run();

		expect(GenericSuggester.Suggest).toHaveBeenCalledWith(
			app,
			expect.arrayContaining([
				getPromptModes().find((mode) => mode.id === "increment")?.label,
				getPromptModes().find((mode) => mode.id === "duplicateSuffix")?.label,
			]),
			expect.arrayContaining(["appendBottom", "increment", "duplicateSuffix"]),
			"If the target file already exists",
		);
		expect(createSpy).not.toHaveBeenCalled();
		expect(app.vault.adapter.exists).toHaveBeenCalledWith("Test Template.md");
	});

	it("creates an incremented file from the original target after prompting", async () => {
		const { app, engine } = createEngine();
		const createdFile = createExistingFile("Test Template1.md");

		engine.choice.fileExistsBehavior = { kind: "prompt" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "Test Template.md",
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue("increment");

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

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"Test Template1.md",
			engine.choice.templatePath,
		);
	});

	it("creates a duplicate-suffix file from the original target after prompting", async () => {
		const { app, engine } = createEngine();
		const createdFile = createExistingFile("Test Template (1).md");

		engine.choice.fileExistsBehavior = { kind: "prompt" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "Test Template.md",
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue("duplicateSuffix");

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

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"Test Template (1).md",
			engine.choice.templatePath,
		);
	});

	it("allows create-another-file modes when the collision target resolves to a folder", async () => {
		const { app, engine } = createEngine();
		const existingFolder = createExistingFolder("Test Template.md");
		const createdFile = createExistingFile("Test Template (1).md");

		engine.choice.fileExistsBehavior = { kind: "prompt" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "Test Template.md",
		);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFolder,
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue("duplicateSuffix");

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

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"Test Template (1).md",
			engine.choice.templatePath,
		);
	});

	it("increments automatically when auto behavior is on", async () => {
		const { app, engine } = createEngine();
		const createdFile = createExistingFile("Test Template1.md");

		engine.choice.fileExistsBehavior = { kind: "apply", mode: "increment" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "Test Template.md",
		);

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

		await engine.run();

		expect(GenericSuggester.Suggest).not.toHaveBeenCalled();
		expect(createSpy).toHaveBeenCalledWith(
			"Test Template1.md",
			engine.choice.templatePath,
		);
	});

	it("applies duplicate suffix automatically when auto behavior is on", async () => {
		const { app, engine } = createEngine();
		const createdFile = createExistingFile("Test Template (1).md");

		engine.choice.fileExistsBehavior = {
			kind: "apply",
			mode: "duplicateSuffix",
		};

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "Test Template.md",
		);

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

		await engine.run();

		expect(GenericSuggester.Suggest).not.toHaveBeenCalled();
		expect(createSpy).toHaveBeenCalledWith(
			"Test Template (1).md",
			engine.choice.templatePath,
		);
	});

	it("falls back to prompt behavior when fileExistsBehavior is missing at runtime", async () => {
		const { app, engine } = createEngine();
		const existingFile = createExistingFile("Test Template.md");

		(engine.choice as any).fileExistsBehavior = undefined;

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue("doNothing");

		await engine.run();

		expect(GenericSuggester.Suggest).toHaveBeenCalledTimes(1);
		expect(engine.choice.fileExistsBehavior).toEqual({ kind: "prompt" });
	});
});
