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
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { settingsStore } from "../settingsStore";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { TemplateChoiceEngine } from "./TemplateChoiceEngine";
import {
	fileExistsAppendToBottom,
	fileExistsDoNothing,
	fileExistsDuplicateSuffix,
	fileExistsIncrement,
	fileExistsModeLabels,
} from "../constants";

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
	fileExistsMode: fileExistsAppendToBottom,
	setFileExistsBehavior: false,
});

const createExistingFile = (path: string) => {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.extension = "md";
	file.basename = file.name.replace(/\.md$/, "");
	return file;
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

		engine.choice.fileExistsMode = fileExistsIncrement;
		engine.choice.setFileExistsBehavior = false;

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue(fileExistsDoNothing);

		const incrementSpy = vi.spyOn(
			engine as unknown as {
				incrementFileName: (filePath: string) => Promise<string>;
			},
			"incrementFileName",
		);

		await engine.run();

		expect(GenericSuggester.Suggest).toHaveBeenCalledWith(
			app,
			expect.arrayContaining([
				fileExistsModeLabels[fileExistsIncrement],
				fileExistsModeLabels[fileExistsDuplicateSuffix],
			]),
			expect.any(Array),
			"If the target file already exists",
		);
		expect(incrementSpy).not.toHaveBeenCalled();
		expect(app.vault.adapter.exists).toHaveBeenCalledWith("Test Template.md");
	});

	it("creates an incremented file from the original target after prompting", async () => {
		const { app, engine } = createEngine();
		const existingFile = createExistingFile("Test Template.md");
		const createdFile = createExistingFile("Test Template1.md");

		engine.choice.fileExistsMode = fileExistsIncrement;
		engine.choice.setFileExistsBehavior = false;

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue(fileExistsIncrement);

		const incrementSpy = vi
			.spyOn(
				engine as unknown as {
					incrementFileName: (filePath: string) => Promise<string>;
				},
				"incrementFileName",
			)
			.mockResolvedValue("Test Template1.md");
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

		expect(incrementSpy).toHaveBeenCalledWith("Test Template.md");
		expect(createSpy).toHaveBeenCalledWith(
			"Test Template1.md",
			engine.choice.templatePath,
		);
	});

	it("creates a duplicate-suffix file from the original target after prompting", async () => {
		const { app, engine } = createEngine();
		const existingFile = createExistingFile("Test Template.md");
		const createdFile = createExistingFile("Test Template (1).md");

		engine.choice.fileExistsMode = fileExistsIncrement;
		engine.choice.setFileExistsBehavior = false;

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue(
			fileExistsDuplicateSuffix,
		);

		const duplicateSpy = vi
			.spyOn(
				engine as unknown as {
					appendDuplicateSuffix: (filePath: string) => Promise<string>;
				},
				"appendDuplicateSuffix",
			)
			.mockResolvedValue("Test Template (1).md");
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

		expect(duplicateSpy).toHaveBeenCalledWith("Test Template.md");
		expect(createSpy).toHaveBeenCalledWith(
			"Test Template (1).md",
			engine.choice.templatePath,
		);
	});

	it("increments automatically when auto behavior is on", async () => {
		const { app, engine } = createEngine();
		const existingFile = createExistingFile("Test Template.md");
		const createdFile = createExistingFile("Test Template1.md");

		engine.choice.fileExistsMode = fileExistsIncrement;
		engine.choice.setFileExistsBehavior = true;

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);

		const incrementSpy = vi
			.spyOn(
				engine as unknown as {
					incrementFileName: (filePath: string) => Promise<string>;
				},
				"incrementFileName",
			)
			.mockResolvedValue("Test Template1.md");
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
		expect(incrementSpy).toHaveBeenCalledWith("Test Template.md");
		expect(createSpy).toHaveBeenCalledWith(
			"Test Template1.md",
			engine.choice.templatePath,
		);
	});

	it("applies duplicate suffix automatically when auto behavior is on", async () => {
		const { app, engine } = createEngine();
		const existingFile = createExistingFile("Test Template.md");
		const createdFile = createExistingFile("Test Template (1).md");

		engine.choice.fileExistsMode = fileExistsDuplicateSuffix;
		engine.choice.setFileExistsBehavior = true;

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);

		const duplicateSpy = vi
			.spyOn(
				engine as unknown as {
					appendDuplicateSuffix: (filePath: string) => Promise<string>;
				},
				"appendDuplicateSuffix",
			)
			.mockResolvedValue("Test Template (1).md");
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
		expect(duplicateSpy).toHaveBeenCalledWith("Test Template.md");
		expect(createSpy).toHaveBeenCalledWith(
			"Test Template (1).md",
			engine.choice.templatePath,
		);
	});
});
