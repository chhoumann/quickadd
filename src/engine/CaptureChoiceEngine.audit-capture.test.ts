import { beforeEach, describe, expect, it, vi } from "vitest";
import { insertOnNewLineBelow } from "../utilityObsidian";

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

const {
	formatContentOnlyMock,
	formatContentWithFileMock,
	setInsertAfterTargetOverrideMock,
	copyFileLinkToClipboardMock,
	getAppendLinkDestinationFileMock,
} = vi.hoisted(() => ({
	formatContentOnlyMock: vi.fn(async (content: string) => content),
	formatContentWithFileMock: vi.fn(async () => ""),
	setInsertAfterTargetOverrideMock: vi.fn(),
	copyFileLinkToClipboardMock: vi.fn(),
	getAppendLinkDestinationFileMock: vi.fn(),
}));

// The engine owns its own no-op (empty-content) detection, so the formatter class
// can be fully stubbed without preserving any module-level helpers.
vi.mock("../formatters/captureChoiceFormatter", () => {
	class CaptureChoiceFormatterMock {
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		setDestinationFile() {}
		setDestinationSourcePath() {}
		setUseSelectionAsCaptureValue() {}
		setInsertAfterTargetOverride(target: string | null) {
			setInsertAfterTargetOverrideMock(target);
		}
		async formatContentOnly(content: string) {
			return formatContentOnlyMock(content);
		}
		async formatContentWithFile(...args: unknown[]) {
			return formatContentWithFileMock(...(args as []));
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
		getResolvedInsertAfterHeading() {
			return null;
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
	appendFileLinkToDestinationFile: vi.fn(),
	copyFileLinkToClipboard: copyFileLinkToClipboardMock,
	getAppendLinkDestinationFile: getAppendLinkDestinationFileMock,
}));

vi.mock("../utilityObsidian", () => ({
	appendToCurrentLine: vi.fn(() => true),
	getMarkdownFilesInFolder: vi.fn(async () => []),
	getMarkdownFilesWithTag: vi.fn(async () => []),
	insertFileLinkToActiveView: vi.fn(),
	insertOnNewLineAbove: vi.fn(() => true),
	insertOnNewLineBelow: vi.fn(() => true),
	isFolder: vi.fn(() => false),
	isTemplaterTriggerOnCreateEnabled: vi.fn(() => false),
	jumpToNextTemplaterCursorIfPossible: vi.fn(),
	openExistingFileTab: vi.fn(() => null),
	openFile: vi.fn(),
	overwriteTemplaterOnce: vi.fn(),
	setMarkdownCursorAtOffset: vi.fn(),
	templaterParseTemplate: vi.fn(async (_app: unknown, content: string) => content),
	waitForTemplaterTriggerOnCreateToComplete: vi.fn(),
}));

vi.mock("three-way-merge", () => ({
	default: vi.fn(() => ({})),
	__esModule: true,
}));

vi.mock("src/gui/InputSuggester/inputSuggester", () => ({
	default: class InputSuggesterMock {},
}));

vi.mock("../main", () => ({ default: class QuickAddMock {} }));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { TFile, type App, Notice } from "obsidian";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { log } from "../logger/logManager";

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

const createCaptureChoice = (
	overrides: Partial<ICaptureChoice> = {},
): ICaptureChoice => ({
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
	format: { enabled: true, format: "{{VALUE}}" },
	prepend: false,
	appendLink: false,
	task: false,
	insertAfter: {
		enabled: false,
		after: "",
		insertAtEnd: false,
		considerSubsections: false,
		createIfNotFound: false,
		createIfNotFoundLocation: "top",
		inline: false,
		replaceExisting: false,
		blankLineAfterMatchMode: "auto",
		promptHeading: false,
	},
	newLineCapture: { enabled: false, direction: "below" },
	openFile: false,
	fileOpening: {
		location: "tab",
		direction: "vertical",
		mode: "source",
		focus: false,
	},
	...overrides,
});

const createExecutor = (): IChoiceExecutor => ({
	execute: vi.fn(),
	recordExecutionResult: vi.fn(),
	variables: new Map<string, unknown>(),
});

const createRunApp = (captureFile: TFile, fileContent = "existing body") =>
	({
		vault: {
			adapter: { exists: vi.fn(async (path: string) => path === captureFile.path) },
			getAbstractFileByPath: vi.fn((path: string) =>
				path === captureFile.path ? captureFile : null,
			),
			read: vi.fn(async () => fileContent),
			modify: vi.fn(async () => {}),
			create: vi.fn(),
		},
		workspace: {
			getActiveFile: vi.fn(() => null),
			getActiveViewOfType: vi.fn(() => null),
		},
		fileManager: { getNewFileParent: vi.fn(() => ({ path: "" })) },
	}) as unknown as App;

const buildRunEngine = (choice: ICaptureChoice, app: App) =>
	new CaptureChoiceEngine(
		app,
		{ settings: { showCaptureNotification: true } } as any,
		choice,
		createExecutor(),
	);

// ---------------------------------------------------------------------------
// Finding: capture-insert-after-heading-picker — the picker must not offer to
// create a heading when "Create line if not found" is off (allowCustomValue).
// ---------------------------------------------------------------------------
describe("CaptureChoiceEngine heading picker create affordance gating", () => {
	const HEADING_NOTE = "# Title\n\n## Tasks\n- a\n";

	const headingChoice = (createIfNotFound: boolean): ICaptureChoice =>
		createCaptureChoice({
			insertAfter: {
				enabled: true,
				after: "",
				insertAtEnd: false,
				considerSubsections: false,
				createIfNotFound,
				createIfNotFoundLocation: "top",
				inline: false,
				replaceExisting: false,
				blankLineAfterMatchMode: "auto",
				promptHeading: true,
			},
		});

	const headingEngine = (choice: ICaptureChoice) =>
		new CaptureChoiceEngine(
			{} as unknown as App,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			choice,
			createExecutor(),
		);

	beforeEach(() => {
		setInsertAfterTargetOverrideMock.mockClear();
		delete (InputSuggester as any).Suggest;
	});

	type SuggestOptions = {
		allowCustomValue: boolean;
		emptyStateText: string;
	};
	const makeSuggestSpy = (returnValue: string) =>
		vi.fn(async (..._args: unknown[]) => returnValue);

	it("disables custom-value (no 'create heading' invite) when createIfNotFound is off", async () => {
		const suggestSpy = makeSuggestSpy("## Tasks");
		(InputSuggester as any).Suggest = suggestSpy;

		await (headingEngine(headingChoice(false)) as any).maybeResolveInsertAfterHeading(
			HEADING_NOTE,
		);

		const options = suggestSpy.mock.calls[0]![3] as SuggestOptions;
		expect(options.allowCustomValue).toBe(false);
		expect(options.emptyStateText).not.toMatch(/type a heading to create/i);
	});

	it("allows custom-value (offers to create a heading) when createIfNotFound is on", async () => {
		const suggestSpy = makeSuggestSpy("## New Heading");
		(InputSuggester as any).Suggest = suggestSpy;

		await (headingEngine(headingChoice(true)) as any).maybeResolveInsertAfterHeading(
			HEADING_NOTE,
		);

		const options = suggestSpy.mock.calls[0]![3] as SuggestOptions;
		expect(options.allowCustomValue).toBe(true);
		expect(options.emptyStateText).toMatch(/type a heading to create/i);
	});
});

// ---------------------------------------------------------------------------
// Finding: capture-empty-content-no-op — an empty/whitespace capture must not
// show a confident "Captured to …" notice.
// ---------------------------------------------------------------------------
describe("CaptureChoiceEngine empty-capture no-op notice", () => {
	beforeEach(() => {
		noticeClass.instances.length = 0;
		formatContentOnlyMock.mockReset();
		formatContentOnlyMock.mockImplementation(async (content: string) => content);
		formatContentWithFileMock.mockReset();
		copyFileLinkToClipboardMock.mockReset();
		copyFileLinkToClipboardMock.mockResolvedValue(true);
		getAppendLinkDestinationFileMock.mockReset();
	});

	it("shows a 'nothing to capture' notice (not 'Captured to') when the payload is empty", async () => {
		const captureFile = createTestFile("Daily/Test.md");
		const app = createRunApp(captureFile, "existing body");
		// Empty payload: first pass resolves to "", and the with-file pass returns
		// the file unchanged (the real formatter's empty-content behavior).
		formatContentOnlyMock.mockResolvedValue("");
		formatContentWithFileMock.mockResolvedValue("existing body");
		const engine = buildRunEngine(createCaptureChoice(), app);

		await engine.run();

		expect(noticeClass.instances).toHaveLength(1);
		const message = noticeClass.instances[0]!.message;
		expect(message).toMatch(/nothing to capture/i);
		expect(message).not.toMatch(/^Captured to/);
	});

	it("still shows the normal success notice when the payload is non-empty", async () => {
		const captureFile = createTestFile("Daily/Test.md");
		const app = createRunApp(captureFile, "existing body");
		formatContentOnlyMock.mockResolvedValue("new line");
		formatContentWithFileMock.mockResolvedValue("existing body\nnew line");
		const engine = buildRunEngine(createCaptureChoice(), app);

		await engine.run();

		expect(noticeClass.instances).toHaveLength(1);
		const message = noticeClass.instances[0]!.message;
		expect(message).toMatch(/Captured to/);
		expect(message).not.toMatch(/nothing to capture/i);
	});

	it("treats a whitespace-only payload as a no-op", async () => {
		const captureFile = createTestFile("Daily/Test.md");
		const app = createRunApp(captureFile, "existing body");
		// ASCII whitespace only -> the real formatter returns the file unchanged.
		formatContentOnlyMock.mockResolvedValue("   \n\t");
		formatContentWithFileMock.mockResolvedValue("existing body");
		const engine = buildRunEngine(createCaptureChoice(), app);

		await engine.run();

		expect(noticeClass.instances[0]!.message).toMatch(/nothing to capture/i);
	});

	// Codex re-review: an empty payload on an editor-insertion action must NOT
	// touch the editor (a newLine* insert adds a blank line; currentLine's
	// replaceSelection("") deletes the selection) while reporting "nothing to
	// capture".
	it("does not insert into the editor on an empty newLine capture", async () => {
		const insertOnNewLineBelowMock = vi.mocked(insertOnNewLineBelow);
		insertOnNewLineBelowMock.mockClear();
		const captureFile = createTestFile("Daily/Test.md");
		const app = createRunApp(captureFile, "existing body");
		app.workspace.getActiveFile = vi.fn(() => captureFile);
		formatContentOnlyMock.mockResolvedValue("");
		formatContentWithFileMock.mockResolvedValue("existing body");
		const choice = {
			...createCaptureChoice(),
			captureToActiveFile: true,
			newLineCapture: { enabled: true, direction: "below" as const },
		};
		const engine = buildRunEngine(choice, app);

		await engine.run();

		expect(insertOnNewLineBelowMock).not.toHaveBeenCalled();
		expect(noticeClass.instances[0]!.message).toMatch(/nothing to capture/i);
	});

	it("still inserts into the editor on a non-empty newLine capture", async () => {
		const insertOnNewLineBelowMock = vi.mocked(insertOnNewLineBelow);
		insertOnNewLineBelowMock.mockClear();
		const captureFile = createTestFile("Daily/Test.md");
		const app = createRunApp(captureFile, "existing body");
		app.workspace.getActiveFile = vi.fn(() => captureFile);
		formatContentOnlyMock.mockResolvedValue("a real line");
		formatContentWithFileMock.mockResolvedValue("a real line");
		const choice = {
			...createCaptureChoice(),
			captureToActiveFile: true,
			newLineCapture: { enabled: true, direction: "below" as const },
		};
		const engine = buildRunEngine(choice, app);

		await engine.run();

		expect(insertOnNewLineBelowMock).toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Finding: integrations-field-token-multiselect — the |multi degradation warning
// must also fire for {{FIELD:…|multi}}, not only VALUE/FILE.
// ---------------------------------------------------------------------------
describe("CaptureChoiceEngine |multi degradation warning", () => {
	beforeEach(() => {
		noticeClass.instances.length = 0;
		formatContentOnlyMock.mockReset();
		formatContentOnlyMock.mockImplementation(async (content: string) => content);
		formatContentWithFileMock.mockReset();
		formatContentWithFileMock.mockResolvedValue("existing body\nvalue");
		copyFileLinkToClipboardMock.mockReset();
		copyFileLinkToClipboardMock.mockResolvedValue(true);
		getAppendLinkDestinationFileMock.mockReset();
	});

	// Returns the captured logWarning messages. The spy is restored AFTER the calls
	// are snapshotted (mockRestore clears mock.calls).
	const runWithFormat = async (format: string): Promise<string[]> => {
		const warnSpy = vi.spyOn(log, "logWarning").mockImplementation(() => {});
		try {
			const captureFile = createTestFile("Daily/Test.md");
			const app = createRunApp(captureFile, "existing body");
			const engine = buildRunEngine(
				createCaptureChoice({ format: { enabled: true, format } }),
				app,
			);
			await engine.run();
			return warnSpy.mock.calls.map((c) => String(c[0]));
		} finally {
			warnSpy.mockRestore();
		}
	};

	it("warns for {{FIELD:…|multi}} degrading to a comma string", async () => {
		const messages = await runWithFormat("{{FIELD:tags|multi}}");
		expect(
			messages.some((m) => m.includes("comma-separated strings")),
		).toBe(true);
		// The warning text now names FIELD too.
		expect(messages.some((m) => m.includes("{{FIELD:…|multi}}"))).toBe(true);
	});

	it("still warns for {{VALUE:…|multi}}", async () => {
		const messages = await runWithFormat("{{VALUE:a,b|multi}}");
		expect(
			messages.some((m) => m.includes("comma-separated strings")),
		).toBe(true);
	});

	it("does not warn for non-multi FIELD tokens", async () => {
		const messages = await runWithFormat("{{FIELD:tags}}");
		expect(
			messages.some((m) => m.includes("comma-separated strings")),
		).toBe(false);
	});
});
