import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { isFolder, openFile } from "../utilityObsidian";
import { QA_INTERNAL_CAPTURE_TARGET_FILE_PATH } from "../constants";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";

const { setUseSelectionAsCaptureValueMock, setTitleMock } = vi.hoisted(() => ({
	setUseSelectionAsCaptureValueMock: vi.fn(),
	setTitleMock: vi.fn(),
}));

vi.mock("../formatters/captureChoiceFormatter", () => ({
	CaptureChoiceFormatter: class {
		setLinkToCurrentFileBehavior() {}
		setUseSelectionAsCaptureValue(value: boolean) {
			setUseSelectionAsCaptureValueMock(value);
		}
		setTitle(value: string) {
			setTitleMock(value);
		}
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
		setTitleMock.mockClear();
		vi.mocked(openFile).mockClear();
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
});

describe("CaptureChoiceEngine capture target resolution", () => {
	beforeEach(() => {
		vi.mocked(isFolder).mockReset();
		setTitleMock.mockClear();
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

	it("rejects explicit .base capture target paths", () => {
		const app = createApp();
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "Boards/Kanban.base" }),
			createExecutor(),
		);

		expect(() =>
			(engine as any).resolveCaptureTarget("Boards/Kanban.base"),
		).toThrow(ChoiceAbortError);
	});

	it("rejects preselected .base capture target paths", async () => {
		const app = createApp();
		const executor = createExecutor();
		executor.variables.set(
			QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			"Boards/Kanban.base",
		);
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice(),
			executor,
		);

		await expect(
			(engine as any).getFormattedPathToCaptureTo(false),
		).rejects.toBeInstanceOf(ChoiceAbortError);
	});

	it("preserves explicit .canvas capture target paths", async () => {
		const app = createApp();
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "Boards/Map.canvas" }),
			createExecutor(),
		);

		const result = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(result).toBe("Boards/Map.canvas");
	});

	it("uses extensionless title for created .canvas capture files", async () => {
		const app = createApp() as any;
		app.vault.read = vi.fn(async () => "");

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
			}),
			createExecutor(),
		);

		(engine as any).createFileWithInput = vi.fn(async (path: string) => ({
			path,
			basename: path.split("/").pop()?.replace(/\.(base|canvas)$/i, "") ?? "",
			extension: path.endsWith(".base") ? "base" : "canvas",
		}));

		await (engine as any).onCreateFileIfItDoesntExist(
			"Boards/Map.canvas",
			"capture",
		);

		expect(setTitleMock).toHaveBeenCalledWith("Map");
	});

	it("routes active canvas file-card capture to linked markdown path", async () => {
		const canvasFile = {
			path: "Boards/Map.canvas",
			basename: "Map",
			extension: "canvas",
		};
		const linkedFile = {
			path: "Folder/Note.md",
			basename: "Note",
			extension: "md",
		};
		const app = createApp() as any;
		app.workspace.activeLeaf = {
			view: {
				getViewType: () => "canvas",
				file: canvasFile,
				canvas: {
					selection: new Set([
						{ type: "file", file: { path: "Folder/Note.md" } },
					]),
				},
			},
		};
		app.workspace.getActiveFile = vi.fn(() => canvasFile);
		app.vault.getAbstractFileByPath = vi.fn((path: string) =>
			path === "Folder/Note.md" ? linkedFile : null,
		);
		app.vault.modify = vi.fn(async () => {});

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				captureToActiveFile: true,
				activeFileWritePosition: "top",
			}),
			createExecutor(),
		);

		const fileExistsMock = vi.fn(async () => true);
		const onFileExistsMock = vi.fn(async () => ({
			file: linkedFile,
			newFileContent: "updated",
			captureContent: "capture",
		}));
		(engine as any).fileExists = fileExistsMock;
		(engine as any).onFileExists = onFileExistsMock;

		await engine.run();

		expect(fileExistsMock).toHaveBeenCalledWith("Folder/Note.md");
		expect(fileExistsMock).not.toHaveBeenCalledWith("Boards/Map.canvas");
		expect(onFileExistsMock).toHaveBeenCalledWith(
			"Folder/Note.md",
			expect.any(String),
		);
		expect(app.vault.modify).toHaveBeenCalledWith(linkedFile, "updated");
	});

	it("aborts cursor-mode capture for active canvas file cards before writes", async () => {
		const canvasFile = {
			path: "Boards/Map.canvas",
			basename: "Map",
			extension: "canvas",
		};
		const app = createApp() as any;
		app.workspace.activeLeaf = {
			view: {
				getViewType: () => "canvas",
				file: canvasFile,
				canvas: {
					selection: new Set([
						{ type: "file", file: { path: "Folder/Note.md" } },
					]),
				},
			},
		};
		app.workspace.getActiveFile = vi.fn(() => canvasFile);
		app.vault.getAbstractFileByPath = vi.fn();
		app.vault.modify = vi.fn(async () => {});

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				captureToActiveFile: true,
			}),
			createExecutor(),
		);

		const fileExistsMock = vi.fn();
		const onFileExistsMock = vi.fn();
		(engine as any).fileExists = fileExistsMock;
		(engine as any).onFileExists = onFileExistsMock;

		await engine.run();

		expect(app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
		expect(fileExistsMock).not.toHaveBeenCalled();
		expect(onFileExistsMock).not.toHaveBeenCalled();
		expect(app.vault.modify).not.toHaveBeenCalled();
	});
});
