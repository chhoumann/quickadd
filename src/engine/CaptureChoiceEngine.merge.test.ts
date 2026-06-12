import { beforeEach, describe, expect, it, vi } from "vitest";

const { formatContentWithFileMock } = vi.hoisted(() => ({
	formatContentWithFileMock: vi.fn(),
}));

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

vi.mock("../formatters/captureChoiceFormatter", () => ({
	CaptureChoiceFormatter: class {
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		setDestinationFile() {}
		setDestinationSourcePath() {}
		setUseSelectionAsCaptureValue() {}
		async withTemplatePropertyCollection<T>(work: () => Promise<T>) {
			return await work();
		}
		async formatContentOnly(content: string) {
			return content;
		}
		async formatContentWithFile(
			content: string,
			...args: unknown[]
		): Promise<string> {
			return await formatContentWithFileMock(content, ...args);
		}
		async formatFileName(name: string) {
			return name;
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
	},
}));

vi.mock("../utilityObsidian", () => ({
	appendToCurrentLine: vi.fn(),
	getMarkdownFilesInFolder: vi.fn(async () => []),
	getMarkdownFilesWithTag: vi.fn(async () => []),
	insertFileLinkToActiveView: vi.fn(),
	insertOnNewLineAbove: vi.fn(),
	insertOnNewLineBelow: vi.fn(),
	isFolder: vi.fn(() => false),
	isTemplaterTriggerOnCreateEnabled: vi.fn(() => false),
	jumpToNextTemplaterCursorIfPossible: vi.fn(),
	openExistingFileTab: vi.fn(() => null),
	openFile: vi.fn(),
	overwriteTemplaterOnce: vi.fn(),
	templaterParseTemplate: vi.fn(async (_app, content) => content),
	waitForTemplaterTriggerOnCreateToComplete: vi.fn(),
}));

vi.mock("src/gui/InputSuggester/inputSuggester", () => ({
	default: class InputSuggesterMock {},
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

import type { App } from "obsidian";
import { TFile } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ICaptureChoice from "../types/choices/ICaptureChoice";

const createCaptureChoice = (): ICaptureChoice => ({
	name: "Test Capture Choice",
	id: "capture-choice-id",
	type: "Capture",
	command: false,
	captureTo: "Daily/Test.md",
	captureToActiveFile: false,
	createFileIfItDoesntExist: {
		enabled: false,
		createWithTemplate: false,
		template: "",
	},
	format: { enabled: false, format: "{{VALUE}}" },
	prepend: false,
	appendLink: false,
	task: false,
	insertAfter: {
		enabled: false,
		after: "",
		insertAtEnd: false,
		considerSubsections: false,
		createIfNotFound: false,
		createIfNotFoundLocation: "",
	},
	newLineCapture: {
		enabled: false,
		direction: "below",
	},
	openFile: false,
	fileOpening: {
		location: "tab",
		direction: "vertical",
		mode: "source",
		focus: false,
	},
});

const createFile = (path: string) => {
	const file = new TFile();
	file.path = path;
	file.name = "Test.md";
	file.basename = "Test";
	file.extension = "md";
	return file;
};

const createEngine = ({
	firstRead,
	secondRead,
	formattedFileContent,
}: {
	firstRead: string;
	secondRead: string;
	formattedFileContent: string;
}) => {
	const filePath = "Daily/Test.md";
	const file = createFile(filePath);
	const app = {
		vault: {
			adapter: {
				exists: vi.fn(async () => true),
			},
			getAbstractFileByPath: vi.fn(() => file),
			read: vi
				.fn()
				.mockResolvedValueOnce(firstRead)
				.mockResolvedValueOnce(secondRead),
			modify: vi.fn(),
			create: vi.fn(),
		},
		workspace: {
			getActiveFile: vi.fn(() => null),
			getActiveViewOfType: vi.fn(() => null),
		},
		fileManager: {
			getNewFileParent: vi.fn(() => ({ path: "" })),
		},
	} as unknown as App;

	const plugin = { settings: { showCaptureNotification: true } } as any;
	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
	};
	const engine = new CaptureChoiceEngine(
		app,
		plugin,
		createCaptureChoice(),
		choiceExecutor,
	);

	formatContentWithFileMock.mockResolvedValue(formattedFileContent);

	return { engine, filePath };
};

describe("CaptureChoiceEngine concurrent-edit merge", () => {
	beforeEach(() => {
		formatContentWithFileMock.mockReset();
	});

	it("proceeds when concurrent edits can be merged cleanly", async () => {
		const firstRead = "alpha\nbeta\ngamma\n";
		const secondRead = "alpha changed by sync\nbeta\ngamma\n";
		const formattedFileContent = "alpha\nbeta\ngamma\ncaptured ours\n";
		const { engine, filePath } = createEngine({
			firstRead,
			secondRead,
			formattedFileContent,
		});

		const result = await (engine as any).onFileExists(filePath, "captured ours");

		expect(result.newFileContent).toBe(
			"alpha changed by sync\nbeta\ngamma\ncaptured ours\n",
		);
		expect(result.captureContent).toBe("captured ours");
	});

	it("aborts when concurrent edits conflict", async () => {
		const firstRead = "alpha\nbeta\ngamma\n";
		const secondRead = "alpha from sync\nbeta\ngamma\n";
		const formattedFileContent = "alpha from capture\nbeta\ngamma\n";
		const { engine, filePath } = createEngine({
			firstRead,
			secondRead,
			formattedFileContent,
		});

		await expect(
			(engine as any).onFileExists(filePath, "alpha from capture"),
		).rejects.toThrow("has been modified since the last read");
	});

	it("uses formatted content directly when the file did not change between reads", async () => {
		const firstRead = "alpha\nbeta\ngamma\n";
		const formattedFileContent = "alpha\nbeta\ngamma\ncaptured ours\n";
		const { engine, filePath } = createEngine({
			firstRead,
			secondRead: firstRead,
			formattedFileContent,
		});

		const result = await (engine as any).onFileExists(filePath, "captured ours");

		expect(result.newFileContent).toBe(formattedFileContent);
	});
});
