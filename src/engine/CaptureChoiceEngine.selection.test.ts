import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import {
	isFolder,
	jumpToNextTemplaterCursorIfPossible,
	openExistingFileTab,
	openFile,
} from "../utilityObsidian";

const { setUseSelectionAsCaptureValueMock } = vi.hoisted(() => ({
	setUseSelectionAsCaptureValueMock: vi.fn(),
}));

vi.mock("../formatters/captureChoiceFormatter", () => ({
	CaptureChoiceFormatter: class {
		setLinkToCurrentFileBehavior() {}
		setUseSelectionAsCaptureValue(value: boolean) {
			setUseSelectionAsCaptureValueMock(value);
		}
		setTitle() {}
		setDestinationFile() {}
		setDestinationSourcePath() {}
		async formatContentOnly(content: string) {
			return content;
		}
		async formatContentWithFile() {
			return "";
		}
		async formatFileName(name: string) {
			return name;
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
	},
	setUseSelectionAsCaptureValueMock,
}));

vi.mock("../utilityObsidian", () => ({
	appendToCurrentLine: vi.fn(),
	getMarkdownFilesInFolder: vi.fn(() => []),
	getMarkdownFilesWithTag: vi.fn(() => []),
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

vi.mock("three-way-merge", () => ({
	default: vi.fn(() => ({})),
	__esModule: true,
}));

vi.mock("src/gui/InputSuggester/inputSuggester", () => ({
	default: class {},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

const createApp = () =>
	({
		vault: {
			adapter: {
				exists: vi.fn(async () => false),
			},
			getAbstractFileByPath: vi.fn(() => null),
			modify: vi.fn(async () => {}),
			read: vi.fn(async () => ""),
		},
		workspace: {
			getActiveFile: vi.fn(() => null),
		},
		fileManager: {
			getNewFileParent: vi.fn(() => ({ path: "" })),
		},
	} as unknown as App);

const createChoice = (overrides: Partial<ICaptureChoice> = {}): ICaptureChoice => ({
	id: "capture-choice-id",
	name: "Capture Choice",
	type: "Capture",
	command: false,
	captureTo: "Inbox.md",
	captureToActiveFile: false,
	createFileIfItDoesntExist: {
		enabled: false,
		createWithTemplate: false,
		template: "",
	},
	format: { enabled: false, format: "" },
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
		mode: "default",
		focus: true,
	},
	...overrides,
});

const createExecutor = (): IChoiceExecutor => ({
	execute: vi.fn(),
	variables: new Map<string, unknown>(),
});

describe("CaptureChoiceEngine selection-as-value resolution", () => {
	beforeEach(() => {
		setUseSelectionAsCaptureValueMock.mockClear();
		vi.mocked(openFile).mockClear();
		vi.mocked(openExistingFileTab).mockClear();
		vi.mocked(jumpToNextTemplaterCursorIfPossible).mockClear();
	});

	it("uses global setting when no override is set", async () => {
		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice(),
			createExecutor(),
		);

		await engine.run();

		expect(setUseSelectionAsCaptureValueMock).toHaveBeenCalledWith(false);
	});

	it("uses per-choice override when provided", async () => {
		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: true } } as any,
			createChoice({ useSelectionAsCaptureValue: false }),
			createExecutor(),
		);

		await engine.run();

		expect(setUseSelectionAsCaptureValueMock).toHaveBeenCalledWith(false);
	});

	it("allows per-choice override to enable selection", async () => {
		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ useSelectionAsCaptureValue: true }),
			createExecutor(),
		);

		await engine.run();

		expect(setUseSelectionAsCaptureValueMock).toHaveBeenCalledWith(true);
	});

	it("defaults fileOpening when missing", async () => {
		const choice = createChoice({
			openFile: true,
			fileOpening: undefined as unknown as ICaptureChoice["fileOpening"],
			captureToActiveFile: true,
		});
		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: true } } as any,
			choice,
			createExecutor(),
		);
		const file = { path: "Test.md", basename: "Test" } as any;

		(engine as any).getFormattedPathToCaptureTo = vi
			.fn()
			.mockResolvedValue("Test.md");
		(engine as any).fileExists = vi.fn().mockResolvedValue(true);
		(engine as any).onFileExists = vi.fn().mockResolvedValue({
			file,
			existingFileContent: "content",
			newFileContent: "content",
			captureContent: "content",
		});

		await engine.run();

		expect(openFile).toHaveBeenCalledWith(
			expect.anything(),
			file,
			expect.objectContaining({
				location: "tab",
				direction: "vertical",
				mode: "default",
				focus: true,
			}),
		);
	});

	it("moves cursor to inserted capture location after opening a new leaf", async () => {
		const app = createApp();
		vi.mocked(app.vault.read).mockResolvedValue("Header\nBody\nCaptured");

		const choice = createChoice({
			openFile: true,
			captureToActiveFile: false,
		});
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: true } } as any,
			choice,
			createExecutor(),
		);

		const setCursor = vi.fn();
		const openedLeaf = {
			view: {
				editor: { setCursor },
			},
		} as any;
		const file = { path: "Test.md", basename: "Test" } as any;

		vi.mocked(openExistingFileTab).mockReturnValue(null);
		vi.mocked(openFile).mockResolvedValue(openedLeaf);

		(engine as any).getFormattedPathToCaptureTo = vi
			.fn()
			.mockResolvedValue("Test.md");
		(engine as any).fileExists = vi.fn().mockResolvedValue(true);
		(engine as any).onFileExists = vi.fn().mockResolvedValue({
			file,
			existingFileContent: "Header\nBody",
			newFileContent: "Header\nBody\nCaptured",
			captureContent: "Captured",
		});

		await engine.run();

		expect(setCursor).toHaveBeenCalledWith({ line: 2, ch: 0 });
		expect(jumpToNextTemplaterCursorIfPossible).toHaveBeenCalledWith(
			expect.anything(),
			file,
		);
	});

	it("moves cursor when reusing an already-open tab", async () => {
		const app = createApp();
		vi.mocked(app.vault.read).mockResolvedValue("Header\nCaptured");

		const choice = createChoice({
			openFile: true,
			captureToActiveFile: false,
		});
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: true } } as any,
			choice,
			createExecutor(),
		);

		const setCursor = vi.fn();
		const existingLeaf = {
			view: {
				editor: { setCursor },
			},
		} as any;
		const file = { path: "Test.md", basename: "Test" } as any;

		vi.mocked(openExistingFileTab).mockReturnValue(existingLeaf);

		(engine as any).getFormattedPathToCaptureTo = vi
			.fn()
			.mockResolvedValue("Test.md");
		(engine as any).fileExists = vi.fn().mockResolvedValue(true);
		(engine as any).onFileExists = vi.fn().mockResolvedValue({
			file,
			existingFileContent: "Header",
			newFileContent: "Header\nCaptured",
			captureContent: "Captured",
		});

		await engine.run();

		expect(openFile).not.toHaveBeenCalled();
		expect(setCursor).toHaveBeenCalledWith({ line: 1, ch: 0 });
	});

	it("recomputes cursor from final file content after post-capture rewrites", async () => {
		const app = createApp();
		vi.mocked(app.vault.read).mockResolvedValue("Header\n\nCaptured");

		const choice = createChoice({
			openFile: true,
			captureToActiveFile: false,
			templater: {
				afterCapture: "wholeFile",
			},
		});
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: true } } as any,
			choice,
			createExecutor(),
		);

		const setCursor = vi.fn();
		const openedLeaf = {
			view: {
				editor: { setCursor },
			},
		} as any;
		const file = { path: "Test.md", basename: "Test" } as any;

		vi.mocked(openExistingFileTab).mockReturnValue(null);
		vi.mocked(openFile).mockResolvedValue(openedLeaf);

		(engine as any).getFormattedPathToCaptureTo = vi
			.fn()
			.mockResolvedValue("Test.md");
		(engine as any).fileExists = vi.fn().mockResolvedValue(true);
		(engine as any).onFileExists = vi.fn().mockResolvedValue({
			file,
			existingFileContent: "Header",
			newFileContent: "Header\nCaptured",
			captureContent: "Captured",
		});

		await engine.run();

		// Old behavior used newFileContent and would place line 1.
		// We should now use the final post-processed file content.
		expect(setCursor).toHaveBeenCalledWith({ line: 2, ch: 0 });
	});

	it("keeps cursor on capture when unrelated earlier sections are rewritten", async () => {
		const app = createApp();
		vi.mocked(app.vault.read).mockResolvedValue(
			"Title: updated\nBody\nCaptured",
		);

		const choice = createChoice({
			openFile: true,
			captureToActiveFile: false,
		});
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: true } } as any,
			choice,
			createExecutor(),
		);

		const setCursor = vi.fn();
		const openedLeaf = {
			view: {
				editor: { setCursor },
			},
		} as any;
		const file = { path: "Test.md", basename: "Test" } as any;

		vi.mocked(openExistingFileTab).mockReturnValue(null);
		vi.mocked(openFile).mockResolvedValue(openedLeaf);

		(engine as any).getFormattedPathToCaptureTo = vi
			.fn()
			.mockResolvedValue("Test.md");
		(engine as any).fileExists = vi.fn().mockResolvedValue(true);
		(engine as any).onFileExists = vi.fn().mockResolvedValue({
			file,
			existingFileContent: "Title: old\nBody",
			newFileContent: "Title: old\nBody\nCaptured",
			captureContent: "Captured",
		});

		await engine.run();

		expect(setCursor).toHaveBeenCalledWith({ line: 2, ch: 0 });
	});

	it("skips final cursor recomputation when openFile is disabled", async () => {
		const app = createApp();
		const choice = createChoice({
			openFile: false,
			captureToActiveFile: false,
		});
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: true } } as any,
			choice,
			createExecutor(),
		);
		const file = { path: "Test.md", basename: "Test" } as any;

		(engine as any).getFormattedPathToCaptureTo = vi
			.fn()
			.mockResolvedValue("Test.md");
		(engine as any).fileExists = vi.fn().mockResolvedValue(true);
		(engine as any).onFileExists = vi.fn().mockResolvedValue({
			file,
			existingFileContent: "Body",
			newFileContent: "Body\nCaptured",
			captureContent: "Captured",
		});

		await engine.run();

		expect(app.vault.read).not.toHaveBeenCalled();
	});
});

describe("CaptureChoiceEngine capture target resolution", () => {
	beforeEach(() => {
		vi.mocked(isFolder).mockReset();
	});

	it("treats folder path without trailing slash as folder when folder exists", () => {
		const app = createApp();
		vi.mocked(isFolder).mockReturnValue(true);

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "journals" }),
			createExecutor(),
		);

		const result = (engine as any).resolveCaptureTarget("journals");

		expect(result).toEqual({ kind: "folder", folder: "journals" });
	});

	it("treats trailing slash as folder even when folder does not exist", () => {
		const app = createApp();
		vi.mocked(isFolder).mockReturnValue(false);

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "journals/" }),
			createExecutor(),
		);

		const result = (engine as any).resolveCaptureTarget("journals/");

		expect(result).toEqual({ kind: "folder", folder: "journals" });
	});

	it("treats folder path as file when a file exists", () => {
		const app = createApp();
		vi.mocked(isFolder).mockReturnValue(true);
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue({} as any);

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "journals" }),
			createExecutor(),
		);

		const result = (engine as any).resolveCaptureTarget("journals");

		expect(result).toEqual({ kind: "file", path: "journals" });
	});
});
