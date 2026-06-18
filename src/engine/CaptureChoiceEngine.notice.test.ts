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

const {
	appendFileLinkToDestinationFileMock,
	getAppendLinkDestinationFileMock,
} = vi.hoisted(() => ({
	appendFileLinkToDestinationFileMock: vi.fn(),
	getAppendLinkDestinationFileMock: vi.fn(),
}));

vi.mock("../formatters/captureChoiceFormatter", () => {
	class CaptureChoiceFormatterMock {
		constructor() {}
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		setDestinationFile() {}
		setDestinationSourcePath() {}
		setUseSelectionAsCaptureValue() {}
		async formatContentOnly(content: string) {
			return content;
		}
		async formatContentWithFile(_content: string) {
			return "";
		}
		async formatFileName(name: string) {
			return name;
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
		getCaptureInsertionEndOffset() {
			return undefined;
		}
		consumeCreatedClipboardAttachmentPaths() {
			return [];
		}
	}
	return {
		CaptureChoiceFormatter: CaptureChoiceFormatterMock,
	};
});

vi.mock("../utils/fileLinks", () => ({
	appendFileLinkToDestinationFile: appendFileLinkToDestinationFileMock,
	getAppendLinkDestinationFile: getAppendLinkDestinationFileMock,
}));

vi.mock("../utilityObsidian", () => ({
	appendToCurrentLine: vi.fn(),
	getMarkdownFilesInFolder: vi.fn(async () => []),
	getMarkdownFilesWithTag: vi.fn(async () => []),
	insertFileLinkToActiveView: vi.fn(),
	insertOnNewLineAbove: vi.fn(),
	insertOnNewLineBelow: vi.fn(),
	isFolder: vi.fn(() => false),
	openExistingFileTab: vi.fn(() => null),
	openFile: vi.fn(),
	overwriteTemplaterOnce: vi.fn(),
	templaterParseTemplate: vi.fn(async (_app, content) => content),
	getTemplater: vi.fn(() => ({})),
}));

vi.mock("three-way-merge", () => ({
	default: vi.fn(() => ({})),
	__esModule: true,
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

import { TFile, type App } from "obsidian";
import { Notice } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { MacroAbortError } from "../errors/MacroAbortError";
import { UserCancelError } from "../errors/UserCancelError";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { settingsStore } from "../settingsStore";

const defaultSettingsState = structuredClone(settingsStore.getState());

type NoticeTestClass = typeof Notice & {
	instances: Array<{ message: string; timeout?: number }>;
};

const noticeClass = Notice as unknown as NoticeTestClass;

function createTestFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.slice(path.lastIndexOf("/") + 1);
	file.extension = file.name.slice(file.name.lastIndexOf(".") + 1);
	file.basename = file.name.replace(/\.[^.]+$/, "");
	return file;
}

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

const createEngine = (abortError: Error) => {
	const app = {
		vault: {
			adapter: {
				exists: vi.fn(async () => false),
			},
			getAbstractFileByPath: vi.fn(),
			modify: vi.fn(),
			create: vi.fn(),
		},
		workspace: {
			getActiveFile: vi.fn(() => null),
		},
		fileManager: {
			getNewFileParent: vi.fn(() => ({ path: "" })),
		},
	} as unknown as App;

	const plugin = { settings: settingsStore.getState() } as any;
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

	(engine as any).getFormattedPathToCaptureTo = vi.fn(async () => {
		throw abortError;
	});

	return engine;
};

describe("CaptureChoiceEngine cancellation notices", () => {
	beforeEach(() => {
		settingsStore.setState(structuredClone(defaultSettingsState));
		noticeClass.instances.length = 0;
		appendFileLinkToDestinationFileMock.mockReset();
		getAppendLinkDestinationFileMock.mockReset();
	});

	it("shows a cancellation notice when the setting is enabled", async () => {
		settingsStore.setState({
			...settingsStore.getState(),
			showInputCancellationNotification: true,
		});
		const engine = createEngine(new UserCancelError("Input cancelled by user"));

		await engine.run();

		expect(noticeClass.instances).toHaveLength(1);
		expect(noticeClass.instances[0]?.message).toContain(
			"Capture execution aborted: Input cancelled by user",
		);
	});

	it("suppresses cancellation notices when the setting is disabled", async () => {
		settingsStore.setState({
			...settingsStore.getState(),
			showInputCancellationNotification: false,
		});

		const engine = createEngine(new UserCancelError("Input cancelled by user"));

		await engine.run();

		expect(noticeClass.instances).toHaveLength(0);
	});

	it("still shows notices for other abort reasons", async () => {
		settingsStore.setState({
			...settingsStore.getState(),
			showInputCancellationNotification: false,
		});

		const engine = createEngine(new MacroAbortError("Target file missing"));

		await engine.run();

		expect(noticeClass.instances).toHaveLength(1);
		expect(noticeClass.instances[0]?.message).toContain(
			"Capture execution aborted: Target file missing",
		);
	});

	it("shows notices for choice abort errors even when input cancellation notifications are disabled", async () => {
		settingsStore.setState({
			...settingsStore.getState(),
			showInputCancellationNotification: false,
		});

		const engine = createEngine(
			new ChoiceAbortError("Insert-after target not found: '# Missing'."),
		);

		await engine.run();

		expect(noticeClass.instances).toHaveLength(1);
		expect(noticeClass.instances[0]?.message).toContain(
			"Capture execution aborted: Insert-after target not found: '# Missing'.",
		);
	});

	it("shows a notice when the target file is missing and create is disabled", async () => {
		settingsStore.setState({
			...settingsStore.getState(),
			showInputCancellationNotification: false,
		});

		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async () => false),
				},
				getAbstractFileByPath: vi.fn(),
				modify: vi.fn(),
				create: vi.fn(),
			},
			workspace: {
				getActiveFile: vi.fn(() => null),
			},
			fileManager: {
				getNewFileParent: vi.fn(() => ({ path: "" })),
			},
		} as unknown as App;

		const plugin = { settings: settingsStore.getState() } as any;
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

		await engine.run();

		expect(noticeClass.instances).toHaveLength(1);
		expect(noticeClass.instances[0]?.message).toContain(
			"Capture execution aborted: Target file missing",
		);
	});
});

describe("CaptureChoiceEngine append-link destination", () => {
	beforeEach(() => {
		settingsStore.setState(structuredClone(defaultSettingsState));
		noticeClass.instances.length = 0;
		appendFileLinkToDestinationFileMock.mockReset();
		appendFileLinkToDestinationFileMock.mockResolvedValue(true);
		getAppendLinkDestinationFileMock.mockReset();
	});

	function createAppendLinkHarness() {
		const captureFile = createTestFile("Daily/Test.md");
		const destinationFile = createTestFile("Indexes/MOC.md");
		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async (path: string) => path === captureFile.path),
				},
				getAbstractFileByPath: vi.fn((path: string) =>
					path === captureFile.path ? captureFile : null,
				),
				read: vi.fn(async () => "existing"),
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

		const plugin = {
			settings: {
				...settingsStore.getState(),
				showCaptureNotification: false,
			},
		} as any;
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			recordExecutionResult: vi.fn(),
			variables: new Map<string, unknown>(),
		};
		const choice = createCaptureChoice();
		choice.appendLink = {
			enabled: true,
			placement: "replaceSelection",
			requireActiveFile: true,
			linkType: "embed",
			destination: { type: "specifiedFile", path: destinationFile.path },
		};

		return {
			app,
			captureFile,
			destinationFile,
			choiceExecutor,
			engine: new CaptureChoiceEngine(app, plugin, choice, choiceExecutor),
		};
	}

	it("appends the captured file link to a specified destination without an active editor", async () => {
		const { app, captureFile, destinationFile, choiceExecutor, engine } =
			createAppendLinkHarness();
		getAppendLinkDestinationFileMock.mockReturnValue(destinationFile);

		await engine.run();

		expect(app.vault.modify).toHaveBeenCalledWith(captureFile, "");
		expect(choiceExecutor.recordExecutionResult).toHaveBeenCalledWith({
			status: "success",
			file: captureFile,
		});
		expect(appendFileLinkToDestinationFileMock).toHaveBeenCalledWith(
			app,
			captureFile,
			expect.objectContaining({
				destination: { type: "specifiedFile", path: destinationFile.path },
				linkType: "link",
			}),
		);
	});

	it("does not write the capture when a specified append-link destination is missing", async () => {
		const { app, engine, choiceExecutor } = createAppendLinkHarness();
		getAppendLinkDestinationFileMock.mockReturnValue(null);

		await engine.run();

		expect(app.vault.adapter.exists).not.toHaveBeenCalled();
		expect(app.vault.modify).not.toHaveBeenCalled();
		expect(choiceExecutor.recordExecutionResult).not.toHaveBeenCalled();
		expect(appendFileLinkToDestinationFileMock).not.toHaveBeenCalled();
	});
});
