import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../quickAddSettingsTab", () => {
	const defaultSettings = {
		choices: [],
		inputPrompt: "single-line",
		devMode: false,
		templateFolderPath: "",
		announceUpdates: true,
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
		},
	};

	return {
		DEFAULT_SETTINGS: defaultSettings,
		QuickAddSettingsTab: class {},
	};
});

const { formatFileNameMock, formatFileContentMock } = vi.hoisted(() => {
	return {
		formatFileNameMock: vi.fn<(format: string, prompt: string) => Promise<string>>(),
		formatFileContentMock: vi.fn<() => Promise<string>>().mockResolvedValue(""),
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
	openExistingFileTab: vi.fn(() => false),
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

import type { App } from "obsidian";
import { Notice } from "obsidian";
import { TemplateChoiceEngine } from "./TemplateChoiceEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { MacroAbortError } from "../errors/MacroAbortError";
import { settingsStore } from "../settingsStore";
import { fileExistsAppendToBottom } from "../constants";

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

	return { engine, choiceExecutor };
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
