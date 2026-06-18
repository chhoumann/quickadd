import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, type App } from "obsidian";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import {
	getMarkdownFilesInFolder,
	insertFileLinkToActiveView,
	isFolder,
	openFile,
} from "../utilityObsidian";
import { QA_INTERNAL_CAPTURE_TARGET_FILE_PATH } from "../constants";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { MacroAbortError } from "../errors/MacroAbortError";
import { InputPromptDraftHandler } from "../utils/InputPromptDraftHandler";
import { InputPromptDraftStore } from "../utils/InputPromptDraftStore";

const {
	setUseSelectionAsCaptureValueMock,
	setTitleMock,
	singleTemplateRunMock,
	promptResponses,
	promptHydratedValues,
} = vi.hoisted(() => ({
	setUseSelectionAsCaptureValueMock: vi.fn(),
	setTitleMock: vi.fn(),
	singleTemplateRunMock: vi.fn(async () => ""),
	promptResponses: [] as string[],
	promptHydratedValues: [] as string[],
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
		async withTemplatePropertyCollection<T>(work: () => Promise<T>) {
			return await work();
		}
		async formatContentOnly(content: string) {
			if (!/\{\{value\}\}/i.test(content)) return content;

			const draftHandler = new InputPromptDraftHandler(
				{
					kind: "single",
					header: "Capture Choice",
					placeholder: "",
				},
				() => true,
			);
			const hydrated = draftHandler.hydrate("");
			promptHydratedValues.push(hydrated);
			const submitted = promptResponses.shift() ?? hydrated;
			draftHandler.markChanged();
			draftHandler.persist(submitted, true);

			return content.replace(/\{\{value\}\}/gi, submitted);
		}
		async formatContentWithFile(content: string) {
			return content;
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
	// Editor-insertion helpers return true when the insertion lands; default the mocks
	// to "inserted" so capture-to-active-file paths proceed to the cosmetic/openFile steps.
	appendToCurrentLine: vi.fn(() => true),
	getMarkdownFilesInFolder: vi.fn(() => []),
	getMarkdownFilesWithTag: vi.fn(() => []),
	insertFileLinkToActiveView: vi.fn(),
	insertOnNewLineAbove: vi.fn(() => true),
	insertOnNewLineBelow: vi.fn(() => true),
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

vi.mock("./SingleTemplateEngine", () => ({
	SingleTemplateEngine: class {
		setLinkToCurrentFileBehavior() {}
		async run() {
			return await singleTemplateRunMock();
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
	},
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
			getActiveViewOfType: vi.fn(() => null),
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
		promptResponses.length = 0;
		promptHydratedValues.length = 0;
		InputPromptDraftStore.getInstance().clearAll();
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
		vi.mocked(getMarkdownFilesInFolder).mockReset();
		vi.mocked(getMarkdownFilesInFolder).mockReturnValue([]);
		vi.mocked(insertFileLinkToActiveView).mockReset();
		delete (InputSuggester as any).Suggest;
		setTitleMock.mockClear();
		singleTemplateRunMock.mockReset();
		singleTemplateRunMock.mockResolvedValue("");
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

	it("resolves a property:field=value target", () => {
		const app = createApp();
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "property:type=draft" }),
			createExecutor(),
		);

		expect(
			(engine as any).resolveCaptureTarget("property:type=draft"),
		).toEqual({ kind: "property", field: "type", value: "draft", filter: {} });
	});

	it("keeps a .md-bearing property value as a property target (no misroute)", () => {
		const app = createApp();
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "property:type=draft.md" }),
			createExecutor(),
		);

		// The property branch must precede the .md/extension/folder checks so a
		// value that happens to contain ".md" is matched literally, not as a file.
		expect(
			(engine as any).resolveCaptureTarget("property:type=draft.md"),
		).toEqual({
			kind: "property",
			field: "type",
			value: "draft.md",
			filter: {},
		});
	});

	it("parses pipe filters on a property target", () => {
		const app = createApp();
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "property:type=draft|folder:Notes" }),
			createExecutor(),
		);

		expect(
			(engine as any).resolveCaptureTarget("property:type=draft|folder:Notes"),
		).toEqual({
			kind: "property",
			field: "type",
			value: "draft",
			filter: { folder: "Notes" },
		});
	});

	it("throws on a property target with no field name", () => {
		const app = createApp();
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "property:" }),
			createExecutor(),
		);

		expect(() => (engine as any).resolveCaptureTarget("property:")).toThrow(
			ChoiceAbortError,
		);
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

	it("preserves explicit .CANVAS capture target paths", async () => {
		const app = createApp();
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "Boards/Map.CANVAS" }),
			createExecutor(),
		);

		const result = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(result).toBe("Boards/Map.CANVAS");
	});

	it("builds a single-slash path for a typed custom filename in a folder capture", async () => {
		vi.mocked(getMarkdownFilesInFolder).mockReturnValue([
			{ path: "Inbox/Existing.md" } as any,
		]);
		(InputSuggester as any).Suggest = vi.fn(async () => "note");

		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "Inbox/" }),
			createExecutor(),
		);

		const resolved = await (engine as any).selectFileInFolder("Inbox/", false);

		expect(resolved).not.toContain("//");
		expect(resolved).toBe("Inbox/note.md");
	});

	it("orders the folder picker by recency and gates the create row when enabled", async () => {
		vi.mocked(getMarkdownFilesInFolder).mockReturnValue([
			{ path: "Inbox/Apple.md", basename: "Apple" },
			{ path: "Inbox/Zebra.md", basename: "Zebra" },
			{ path: "Inbox/Mango.md", basename: "Mango" },
		] as any);

		const suggestSpy = vi.fn(async () => "Inbox/Apple.md");
		(InputSuggester as any).Suggest = suggestSpy;

		const app = createApp() as any;
		app.workspace.getLastOpenFiles = () => ["Inbox/Zebra.md"];

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				captureTo: "Inbox/",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
			}),
			createExecutor(),
		);

		await (engine as any).selectFileInFolder("Inbox/", false);

		expect(suggestSpy).toHaveBeenCalledTimes(1);
		const [, displayItems, items, options] = suggestSpy.mock
			.calls[0] as unknown as [
			unknown,
			string[],
			string[],
			{
				allowCustomValue: boolean;
				customValueLabel: (value: string) => string;
			},
		];

		// Recently opened (Zebra) first, then the rest alphabetically.
		expect(items).toEqual([
			"Inbox/Zebra.md",
			"Inbox/Apple.md",
			"Inbox/Mango.md",
		]);
		expect(displayItems).toEqual(["Zebra.md", "Apple.md", "Mango.md"]);
		expect(options.allowCustomValue).toBe(true);
		expect(options.customValueLabel("New")).toBe("Create new note: New");
	});

	it("disables the create row when create-if-not-exists is off", async () => {
		vi.mocked(getMarkdownFilesInFolder).mockReturnValue([
			{ path: "Inbox/Apple.md", basename: "Apple" },
		] as any);

		const suggestSpy = vi.fn(async () => "Inbox/Apple.md");
		(InputSuggester as any).Suggest = suggestSpy;

		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "Inbox/" }),
			createExecutor(),
		);

		await (engine as any).selectFileInFolder("Inbox/", false);

		const options = (suggestSpy.mock.calls[0] as unknown[])[3] as {
			allowCustomValue: boolean;
		};
		expect(options.allowCustomValue).toBe(false);
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

	it("does not copy formatted capture content to clipboard when creating the target file fails", async () => {
		const clipboardWriteText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: clipboardWriteText },
			configurable: true,
		});
		(Notice as unknown as { instances: unknown[] }).instances.length = 0;

		const engine = new CaptureChoiceEngine(
			createApp(),
			{
				settings: {
					useSelectionAsCaptureValue: false,
					showCaptureNotification: true,
				},
			} as any,
			createChoice({
				captureTo: "Bad:Title.md",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
				format: {
					enabled: true,
					format: "Capture body to preserve",
				},
			}),
			createExecutor(),
		);

		(engine as any).createFileWithInput = vi.fn(async () => {
			throw new Error("File name cannot contain ':'");
		});

		await engine.run();

		expect(clipboardWriteText).not.toHaveBeenCalled();
	});

	it("keeps submitted VALUE prompt draft after failed target creation and clears it after success", async () => {
		promptResponses.push("Capture body to preserve");
		const store = InputPromptDraftStore.getInstance();
		const draftKey = store.makeKey({
			kind: "single",
			header: "Capture Choice",
			placeholder: "",
		});

		const engine = new CaptureChoiceEngine(
			createApp(),
			{
				settings: {
					useSelectionAsCaptureValue: false,
					showCaptureNotification: true,
				},
			} as any,
			createChoice({
				captureTo: "Bad:Title.md",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
				format: {
					enabled: true,
					format: "{{VALUE}}",
				},
			}),
			createExecutor(),
		);

		(engine as any).createFileWithInput = vi.fn(async () => {
			throw new Error("File name cannot contain ':'");
		});

		const clipboardWriteText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: clipboardWriteText },
			configurable: true,
		});

		store.beginExecutionScope();
		await engine.run();
		store.commitExecutionScope();

		expect(store.get(draftKey)).toBe("Capture body to preserve");
		expect(clipboardWriteText).not.toHaveBeenCalled();

		const nextDraftHandler = new InputPromptDraftHandler(
			{
				kind: "single",
				header: "Capture Choice",
				placeholder: "",
			},
			() => true,
		);

		expect(nextDraftHandler.hydrate("")).toBe("Capture body to preserve");

		const successfulEngine = new CaptureChoiceEngine(
			createApp(),
			{
				settings: {
					useSelectionAsCaptureValue: false,
					showCaptureNotification: true,
				},
			} as any,
			createChoice({
				captureTo: "Recovered.md",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
				format: {
					enabled: true,
					format: "{{VALUE}}",
				},
			}),
			createExecutor(),
		);
		(successfulEngine as any).createFileWithInput = vi.fn(
			async (path: string) => ({
				path,
				basename: "Recovered",
				extension: "md",
			}),
		);

		store.beginExecutionScope();
		await successfulEngine.run();
		store.commitExecutionScope();

		expect(promptHydratedValues).toContain("Capture body to preserve");
		expect(store.get(draftKey)).toBeUndefined();
	});

	it("does not copy capture content to clipboard when template creation is cancelled", async () => {
		const clipboardWriteText = vi.fn(async () => {});
		Object.defineProperty(navigator, "clipboard", {
			value: { writeText: clipboardWriteText },
			configurable: true,
		});
		singleTemplateRunMock.mockRejectedValueOnce(
			new MacroAbortError("Input cancelled by user"),
		);

		const engine = new CaptureChoiceEngine(
			createApp(),
			{
				settings: {
					useSelectionAsCaptureValue: false,
					showCaptureNotification: true,
				},
			} as any,
			createChoice({
				captureTo: "New.md",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: true,
					template: "Templates/New.md",
				},
				format: {
					enabled: true,
					format: "Capture body should not overwrite clipboard",
				},
			}),
			createExecutor(),
		);

		await engine.run();

		expect(clipboardWriteText).not.toHaveBeenCalled();
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

	it("skips required append-link insertion for canvas file-card capture without markdown context", async () => {
		vi.mocked(insertFileLinkToActiveView).mockImplementation(() => {
			throw new Error("link insertion should be skipped");
		});

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
		app.workspace.getActiveViewOfType = vi.fn(() => null);
		app.vault.getAbstractFileByPath = vi.fn((path: string) =>
			path === "Folder/Note.md" ? linkedFile : null,
		);
		app.vault.modify = vi.fn(async () => {});

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				appendLink: true,
				captureToActiveFile: true,
				activeFileWritePosition: "top",
			}),
			createExecutor(),
		);

		(engine as any).fileExists = vi.fn(async () => true);
		(engine as any).onFileExists = vi.fn(async () => ({
			file: linkedFile,
			newFileContent: "updated",
			captureContent: "capture",
		}));

		await engine.run();

		expect(app.vault.modify).toHaveBeenCalledWith(linkedFile, "updated");
		expect(insertFileLinkToActiveView).not.toHaveBeenCalled();
	});

	it("skips required append-link insertion for active canvas text-card capture without markdown context", async () => {
		vi.mocked(insertFileLinkToActiveView).mockImplementation(() => {
			throw new Error("link insertion should be skipped");
		});

		const setTextMock = vi.fn();
		const app = createApp() as any;
		app.workspace.activeLeaf = {
			view: {
				getViewType: () => "canvas",
				file: {
					path: "Boards/Map.canvas",
					basename: "Map",
					extension: "canvas",
				},
				canvas: {
					selection: new Set([
						{
							id: "text-node-1",
							type: "text",
							text: "Current",
							setText: setTextMock,
						},
					]),
					getData: vi.fn(() => ({
						nodes: [{ id: "text-node-1", type: "text", text: "Current" }],
					})),
					requestSave: vi.fn(),
				},
			},
		};
		app.workspace.getActiveFile = vi.fn(() => ({
			path: "Boards/Map.canvas",
			basename: "Map",
			extension: "canvas",
		}));
		app.workspace.getActiveViewOfType = vi.fn(() => null);

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				appendLink: true,
				captureToActiveFile: true,
				activeFileWritePosition: "top",
			}),
			createExecutor(),
		);

		await engine.run();

		expect(setTextMock).toHaveBeenCalled();
		expect(insertFileLinkToActiveView).not.toHaveBeenCalled();
	});

	it("creates missing linked markdown file for configured canvas file-card targets", async () => {
		const configuredCanvasFile = {
			path: "Boards/Plan.canvas",
			basename: "Plan",
			extension: "canvas",
		};
		const createdFile = {
			path: "Folder/Missing.md",
			basename: "Missing",
			extension: "md",
		};

		const app = createApp() as any;
		app.vault.read = vi.fn(async () =>
			JSON.stringify({
				nodes: [{ id: "node-1", type: "file", file: "Folder/Missing.md" }],
			}),
		);
		app.vault.getAbstractFileByPath = vi.fn((path: string) =>
			path === "Boards/Plan.canvas" ? configuredCanvasFile : null,
		);
		app.vault.modify = vi.fn(async () => {});

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				captureTo: "Boards/Plan.canvas",
				captureToCanvasNodeId: "node-1",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
			}),
			createExecutor(),
		);

		const fileExistsMock = vi.fn(async () => false);
		const onCreateFileIfItDoesntExistMock = vi.fn(
			async (_path: string, _capture: string) => ({
				file: createdFile,
				newFileContent: "created",
				captureContent: "capture",
			}),
		);

		(engine as any).fileExists = fileExistsMock;
		(engine as any).onCreateFileIfItDoesntExist =
			onCreateFileIfItDoesntExistMock;

		await engine.run();

		expect(fileExistsMock).toHaveBeenCalledWith("Folder/Missing.md");
		expect(onCreateFileIfItDoesntExistMock).toHaveBeenCalledWith(
			"Folder/Missing.md",
			expect.any(String),
			expect.objectContaining({ enabled: false }),
		);
		expect(app.vault.modify).toHaveBeenCalledWith(createdFile, "created");
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
