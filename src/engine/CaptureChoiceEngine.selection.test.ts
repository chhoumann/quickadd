import { beforeEach, describe, expect, it, vi } from "vitest";
import { Notice, TFile, TFolder, type App } from "obsidian";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import {
	getMarkdownFilesInFolder,
	getMarkdownFilesMatchingFilter,
	getMarkdownFilesWithProperty,
	insertOnNewLineBelow,
	insertFileLinkToActiveView,
	isFolder,
	jumpToNextTemplaterCursorIfPossible,
	openFile,
	overwriteTemplaterOnce,
	setMarkdownCursorAtOffset,
} from "../utilityObsidian";
import { QA_INTERNAL_CAPTURE_TARGET_FILE_PATH } from "../constants";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";
import { MacroAbortError } from "../errors/MacroAbortError";
import { InputPromptDraftHandler } from "../utils/InputPromptDraftHandler";
import { InputPromptDraftStore } from "../utils/InputPromptDraftStore";
import { log } from "../logger/logManager";

const {
	setUseSelectionAsCaptureValueMock,
	setTitleMock,
	singleTemplateRunMock,
	promptResponses,
	promptHydratedValues,
	createdClipboardAttachmentPaths,
} = vi.hoisted(() => ({
	setUseSelectionAsCaptureValueMock: vi.fn(),
	setTitleMock: vi.fn(),
	singleTemplateRunMock: vi.fn(async () => ""),
	promptResponses: [] as string[],
	promptHydratedValues: [] as string[],
	createdClipboardAttachmentPaths: [] as string[],
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
			if (/\{\{clipboard\}\}/i.test(content)) {
				createdClipboardAttachmentPaths.push("Clipboard image.png");
				return content.replace(/\{\{clipboard\}\}/gi, "![[Clipboard image.png]]");
			}

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
			if (/\{\{clipboard\}\}/i.test(content)) {
				createdClipboardAttachmentPaths.push("Clipboard image.png");
				return content.replace(/\{\{clipboard\}\}/gi, "![[Clipboard image.png]]");
			}

			return content;
		}
		async formatFileName(name: string) {
			return name;
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
		consumeCreatedClipboardAttachmentPaths() {
			return createdClipboardAttachmentPaths.splice(0);
		}
		getCaptureInsertionEndOffset() {
			return null;
		}
	},
	setUseSelectionAsCaptureValueMock,
}));

vi.mock("../utilityObsidian", () => ({
	// Editor-insertion helpers return true when the insertion lands; default the mocks
	// to "inserted" so capture-to-active-file paths proceed to the cosmetic/openFile steps.
	appendToCurrentLine: vi.fn(() => true),
	getMarkdownFilesInFolder: vi.fn(() => []),
	getMarkdownFilesMatchingFilter: vi.fn(() => []),
	getMarkdownFilesWithProperty: vi.fn(() => []),
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
	setMarkdownCursorAtOffset: vi.fn(() => true),
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
			delete: vi.fn(async () => {}),
			modify: vi.fn(async () => {}),
			read: vi.fn(async () => ""),
			getMarkdownFiles: vi.fn(() => []),
		},
		metadataCache: {
			getFileCache: vi.fn(() => null),
		},
		workspace: {
			getActiveFile: vi.fn(() => null),
			getActiveViewOfType: vi.fn(() => null),
		},
		fileManager: {
			getNewFileParent: vi.fn(() => ({ path: "" })),
			trashFile: vi.fn(async () => {}),
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
		createdClipboardAttachmentPaths.length = 0;
		InputPromptDraftStore.getInstance().clearAll();
		vi.mocked(openFile).mockClear();
		vi.mocked(getMarkdownFilesMatchingFilter).mockReset();
		vi.mocked(getMarkdownFilesMatchingFilter).mockReturnValue([]);
		vi.mocked(getMarkdownFilesWithProperty).mockReset();
		vi.mocked(getMarkdownFilesWithProperty).mockReturnValue([]);
		vi.mocked(insertFileLinkToActiveView).mockReset();
		vi.mocked(insertOnNewLineBelow).mockReturnValue(true);
		vi.mocked(overwriteTemplaterOnce).mockClear();
		vi.mocked(jumpToNextTemplaterCursorIfPossible).mockReset();
		vi.mocked(jumpToNextTemplaterCursorIfPossible).mockResolvedValue(false);
		vi.mocked(setMarkdownCursorAtOffset).mockClear();
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

	it("places the cursor after a focused opened file-based capture", async () => {
		const app = createApp();
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
		const file = { path: "Test.md", basename: "Test", extension: "md" } as any;

		(engine as any).getFormattedPathToCaptureTo = vi
			.fn()
			.mockResolvedValue("Test.md");
		(engine as any).fileExists = vi.fn().mockResolvedValue(true);
		(engine as any).onFileExists = vi.fn().mockResolvedValue({
			file,
			newFileContent: "Line A\nCAPTURE\nLine B",
			captureContent: "CAPTURE\n",
			cursorEndOffset: "Line A\nCAPTURE\n".length,
			cursorPlacementSafe: true,
		});

		await engine.run();

		expect(setMarkdownCursorAtOffset).toHaveBeenCalledWith(
			app,
			file,
			"Line A\nCAPTURE\n".length,
			"Line A\nCAPTURE\nLine B",
		);
	});

	it("does not place the cursor when the opened file is not focused", async () => {
		const choice = createChoice({
			openFile: true,
			captureToActiveFile: false,
			fileOpening: {
				location: "tab",
				direction: "vertical",
				mode: "default",
				focus: false,
			},
		});
		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: true } } as any,
			choice,
			createExecutor(),
		);
		const file = { path: "Test.md", basename: "Test", extension: "md" } as any;

		(engine as any).getFormattedPathToCaptureTo = vi
			.fn()
			.mockResolvedValue("Test.md");
		(engine as any).fileExists = vi.fn().mockResolvedValue(true);
		(engine as any).onFileExists = vi.fn().mockResolvedValue({
			file,
			newFileContent: "CAPTURE",
			captureContent: "CAPTURE",
			cursorEndOffset: "CAPTURE".length,
			cursorPlacementSafe: true,
		});

		await engine.run();

		expect(setMarkdownCursorAtOffset).not.toHaveBeenCalled();
	});

	it("does not override Templater cursor jumps", async () => {
		vi.mocked(jumpToNextTemplaterCursorIfPossible).mockResolvedValue(true);
		const choice = createChoice({
			openFile: true,
			captureToActiveFile: false,
		});
		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: true } } as any,
			choice,
			createExecutor(),
		);
		const file = { path: "Test.md", basename: "Test", extension: "md" } as any;

		(engine as any).getFormattedPathToCaptureTo = vi
			.fn()
			.mockResolvedValue("Test.md");
		(engine as any).fileExists = vi.fn().mockResolvedValue(true);
		(engine as any).onFileExists = vi.fn().mockResolvedValue({
			file,
			newFileContent: "CAPTURE",
			captureContent: "CAPTURE",
			cursorEndOffset: "CAPTURE".length,
			cursorPlacementSafe: true,
		});

		await engine.run();

		expect(setMarkdownCursorAtOffset).not.toHaveBeenCalled();
	});

	it("does not place the cursor after whole-file Templater post-processing", async () => {
		const choice = createChoice({
			openFile: true,
			captureToActiveFile: false,
			templater: { afterCapture: "wholeFile" },
		});
		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: true } } as any,
			choice,
			createExecutor(),
		);
		const file = { path: "Test.md", basename: "Test", extension: "md" } as any;

		(engine as any).getFormattedPathToCaptureTo = vi
			.fn()
			.mockResolvedValue("Test.md");
		(engine as any).fileExists = vi.fn().mockResolvedValue(true);
		(engine as any).onFileExists = vi.fn().mockResolvedValue({
			file,
			newFileContent: "CAPTURE",
			captureContent: "CAPTURE",
			cursorEndOffset: "CAPTURE".length,
			cursorPlacementSafe: true,
		});

		await engine.run();

		expect(overwriteTemplaterOnce).toHaveBeenCalled();
		expect(setMarkdownCursorAtOffset).not.toHaveBeenCalled();
	});

	it("warns when FILE multi cannot become a YAML list in Capture", async () => {
		const warningSpy = vi
			.spyOn(log, "logWarning")
			.mockImplementation(() => {});
		const choice = createChoice({
			format: {
				enabled: true,
				format: "---\nrelated: {{FILE:People|multi}}\n---\n",
			},
		});
		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			choice,
			createExecutor(),
		);
		const file = { path: "Test.md", basename: "Test", extension: "md" } as any;

		(engine as any).getFormattedPathToCaptureTo = vi
			.fn()
			.mockResolvedValue("Test.md");
		(engine as any).fileExists = vi.fn().mockResolvedValue(true);
		(engine as any).onFileExists = vi.fn().mockResolvedValue({
			file,
			newFileContent: "content",
			captureContent: "content",
		});

		try {
			await engine.run();

			expect(warningSpy).toHaveBeenCalledWith(
				expect.stringContaining("{{FILE:…|multi}}"),
			);
		} finally {
			warningSpy.mockRestore();
		}
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

	it("normalizes control characters before folder route decisions", () => {
		const app = createApp();
		vi.mocked(isFolder).mockReturnValue(false);

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "journals\n/" }),
			createExecutor(),
		);

		const result = (engine as any).resolveCaptureTarget("journals\n/");

		expect(result).toEqual({ kind: "folder", folder: "journals" });
	});

	it("treats folder path as file when a same-name note exists", () => {
		const app = createApp();
		vi.mocked(isFolder).mockReturnValue(true);
		// A real note (TFile) at `journals.md`, not just any abstract file - a
		// folder that merely shares the name must NOT count (see the TFolder case).
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(
			Object.assign(new TFile(), { path: "journals.md" }),
		);

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "journals" }),
			createExecutor(),
		);

		const result = (engine as any).resolveCaptureTarget("journals");

		expect(result).toEqual({ kind: "file", path: "journals" });
	});

	it("treats folder path as folder when a same-name FOLDER (not a note) exists", () => {
		const app = createApp();
		vi.mocked(isFolder).mockReturnValue(true);
		// `journals.md` is a folder, not a note -> the bare name stays a folder
		// scope; resolving to the file path would target a folder and fail the write.
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(
			Object.assign(new TFolder(), { path: "journals.md" }),
		);

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "journals" }),
			createExecutor(),
		);

		const result = (engine as any).resolveCaptureTarget("journals");

		expect(result).toEqual({ kind: "folder", folder: "journals" });
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
			filter: { folder: "Notes", folders: ["Notes"] },
		});
	});

	it("resolves a hashtag target with extra pipe filters", () => {
		const app = createApp();
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "#work|tag:project" }),
			createExecutor(),
		);

		expect(
			(engine as any).resolveCaptureTarget("#work|tag:project"),
		).toEqual({
			kind: "filter",
			filter: { tags: ["work", "project"] },
		});
	});

	it("resolves repeated folder filters as a filtered target", () => {
		const app = createApp();
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "folder:Goals|folder:Projects|tag:active" }),
			createExecutor(),
		);

		expect(
			(engine as any).resolveCaptureTarget(
				"folder:Goals|folder:Projects|tag:active",
			),
		).toEqual({
			kind: "filter",
			filter: {
				folder: "Goals",
				folders: ["Goals", "Projects"],
				tags: ["active"],
			},
		});
	});

	it("rejects multi-select on capture target filters", () => {
		const app = createApp();
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "tag:work|multi" }),
			createExecutor(),
		);

		expect(() =>
			(engine as any).resolveCaptureTarget("tag:work|multi"),
		).toThrow(ChoiceAbortError);
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
		// A vault-wide "Capture to" legitimately honours a preselected pick, so the
		// `.base` guard is exercised on the path it actually uses.
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "" }),
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

	// Security: a drive/absolute 'Capture to' must be rejected at path assembly,
	// BEFORE run()'s `fileExists(filePath)` existence probe — otherwise on Windows
	// the probe would stat an out-of-vault path. normalizeGeneratedFilePath passes
	// drive paths through to the boundary check, so this exercises that guard.
	it("refuses a drive/absolute capture target before the existence probe", async () => {
		// A leading-slash "/etc/secret.md" is stripped to the in-vault "etc/secret.md"
		// (root-relative convention), so the escapes that reach this guard are the
		// drive forms that normalizeGeneratedFilePath passes through.
		for (const captureTo of ["C:/secret.md", "C:\\secret.md"]) {
			const app = createApp();
			const engine = new CaptureChoiceEngine(
				app,
				{ settings: { useSelectionAsCaptureValue: false } } as any,
				createChoice({ captureTo }),
				createExecutor(),
			);

			await expect(
				(engine as any).getFormattedPathToCaptureTo(false),
			).rejects.toBeInstanceOf(ChoiceAbortError);
			// The out-of-vault path never reached an existence probe.
			expect(app.vault.adapter.exists).not.toHaveBeenCalled();
		}
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

	it("uses normalized folder paths for folder capture pickers", async () => {
		vi.mocked(getMarkdownFilesInFolder).mockReturnValue([
			{ path: "Inbox/Existing.md" } as any,
		]);
		const suggestSpy = vi.fn(async () => "Inbox/Existing.md");
		(InputSuggester as any).Suggest = suggestSpy;

		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "Inbox\n/" }),
			createExecutor(),
		);

		const resolved = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(getMarkdownFilesInFolder).toHaveBeenCalledWith(
			expect.anything(),
			"Inbox/",
		);
		expect(resolved).toBe("Inbox/Existing.md");
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
				searchItems: string[];
			},
		];

		// Recently opened (Zebra) first, then the rest alphabetically.
		expect(items).toEqual([
			"Inbox/Zebra.md",
			"Inbox/Apple.md",
			"Inbox/Mango.md",
		]);
		expect(displayItems).toEqual(["Zebra", "Apple", "Mango"]);
		expect(options.searchItems).toEqual([
			"Zebra Inbox/Zebra.md",
			"Apple Inbox/Apple.md",
			"Mango Inbox/Mango.md",
		]);
		expect(options.allowCustomValue).toBe(true);
		expect(options.customValueLabel("New")).toBe("Create new note: New");
	});

	it("suppresses folder create rows for values that normalize to existing files", async () => {
		vi.mocked(getMarkdownFilesInFolder).mockReturnValue([
			{ path: "Inbox/Apple.md", basename: "Apple" },
		] as any);

		const suggestSpy = vi.fn(async () => "Inbox/Apple.md");
		(InputSuggester as any).Suggest = suggestSpy;
		const app = createApp() as any;
		app.vault.getAbstractFileByPath = vi.fn((path: string) =>
			path === "Inbox/Line Break.md" ? { path } : null,
		);

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

		const options = (suggestSpy.mock.calls[0] as unknown[])[3] as {
			valueExists: (value: string) => boolean;
		};
		expect(options.valueExists("Line\nBreak")).toBe(true);
	});

	it("suppresses vault create rows for basenames normalized to existing files", () => {
		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice(),
			createExecutor(),
		);

		expect(
			(engine as any).captureTargetAlreadyExists(
				"Line\nBreak",
				new Set(["line break"]),
			),
		).toBe(true);
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

	it("opens the folder picker for an empty folder when create-if-not-exists is on", async () => {
		vi.mocked(getMarkdownFilesInFolder).mockReturnValue([]);
		const suggestSpy = vi.fn(async () => "New From Empty");
		(InputSuggester as any).Suggest = suggestSpy;

		const engine = new CaptureChoiceEngine(
			createApp(),
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

		const resolved = await (engine as any).selectFileInFolder("Inbox", false);

		expect(suggestSpy).toHaveBeenCalledTimes(1);
		const [, displayItems, items, options] = suggestSpy.mock
			.calls[0] as unknown as [
			unknown,
			string[],
			string[],
			{
				allowCustomValue: boolean;
				placeholder: string;
				emptyStateText: string;
				valueExists: (value: string) => boolean;
			},
		];
		expect(displayItems).toEqual([]);
		expect(items).toEqual([]);
		expect(options.allowCustomValue).toBe(true);
		expect(options.placeholder).toBe("Choose a note or type to create one");
		expect(options.emptyStateText).toBe("Type a note name to create it");
		expect(options.valueExists("New From Empty")).toBe(false);
		expect(resolved).toBe("Inbox/New From Empty.md");
	});

	it("keeps empty folder captures as an error when create-if-not-exists is off", async () => {
		vi.mocked(getMarkdownFilesInFolder).mockReturnValue([]);
		const suggestSpy = vi.fn();
		(InputSuggester as any).Suggest = suggestSpy;

		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "Inbox/" }),
			createExecutor(),
		);

		await expect(
			(engine as any).selectFileInFolder("Inbox", false),
		).rejects.toThrow("Folder Inbox/ is empty.");
		expect(suggestSpy).not.toHaveBeenCalled();
	});

	it("opens scoped filter pickers with no matches when create-if-not-exists is on", async () => {
		vi.mocked(getMarkdownFilesMatchingFilter).mockReturnValue([]);
		const suggestSpy = vi.fn(async () => "New From Empty");
		(InputSuggester as any).Suggest = suggestSpy;

		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				captureTo: "#empty",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
			}),
			createExecutor(),
		);

		const resolved = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(getMarkdownFilesMatchingFilter).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ tags: ["empty"] }),
		);
		expect(suggestSpy).toHaveBeenCalledTimes(1);
		const [, displayItems, items, options] = suggestSpy.mock
			.calls[0] as unknown as [
			unknown,
			string[],
			string[],
			{
				allowCustomValue: boolean;
				placeholder: string;
				emptyStateText: string;
			},
		];
		expect(displayItems).toEqual([]);
		expect(items).toEqual([]);
		expect(options.allowCustomValue).toBe(true);
		expect(options.placeholder).toBe("Choose a note or type to create one");
		expect(options.emptyStateText).toBe("Type a note name to create it");
		expect(resolved).toBe("New From Empty.md");
	});

	it("opens empty property pickers with vault-wide duplicate suppression when create-if-not-exists is on", async () => {
		vi.mocked(getMarkdownFilesWithProperty).mockReturnValue([]);
		const suggestSpy = vi.fn(async () => "Fresh Draft");
		(InputSuggester as any).Suggest = suggestSpy;
		const app = createApp() as any;
		app.vault.getMarkdownFiles = vi.fn(() => [
			{ path: "Archive/Existing.md", basename: "Existing" },
		]);

		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				captureTo: "property:type=draft",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
			}),
			createExecutor(),
		);

		const resolved = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(getMarkdownFilesWithProperty).toHaveBeenCalledWith(
			app,
			"type",
			"draft",
			expect.any(Object),
		);
		const options = (suggestSpy.mock.calls[0] as unknown[])[3] as {
			valueExists: (value: string) => boolean;
		};
		expect(options.valueExists("Existing")).toBe(true);
		expect(options.valueExists("Fresh Draft")).toBe(false);
		expect(resolved).toBe("Fresh Draft.md");
	});

	it("keeps empty scoped filter captures as an error when create-if-not-exists is off", async () => {
		const suggestSpy = vi.fn();
		(InputSuggester as any).Suggest = suggestSpy;

		const engine = new CaptureChoiceEngine(
			createApp(),
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureTo: "#empty" }),
			createExecutor(),
		);

		await expect(
			(engine as any).getFormattedPathToCaptureTo(false),
		).rejects.toThrow("No files matched the capture target filters.");
		expect(suggestSpy).not.toHaveBeenCalled();
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

	it("removes a created clipboard attachment when editor insertion fails before commit", async () => {
		const targetFile = new TFile();
		targetFile.path = "Inbox.md";
		targetFile.basename = "Inbox";
		const attachmentFile = new TFile();
		attachmentFile.path = "Clipboard image.png";
		attachmentFile.basename = "Clipboard image";
		const app = createApp() as any;
		app.workspace.getActiveFile = vi.fn(() => targetFile);
		app.vault.adapter.exists = vi.fn(async () => true);
		app.vault.getAbstractFileByPath = vi.fn((path: string) =>
			path === "Inbox.md" ? targetFile : attachmentFile,
		);
		vi.mocked(insertOnNewLineBelow).mockReturnValue(false);

		const executor = createExecutor();
		executor.recordExecutionResult = vi.fn();
		const engine = new CaptureChoiceEngine(
			app,
			{
				settings: {
					useSelectionAsCaptureValue: false,
					showCaptureNotification: true,
				},
			} as any,
			createChoice({
				captureToActiveFile: true,
				newLineCapture: { enabled: true, direction: "below" },
				format: { enabled: true, format: "{{clipboard}}" },
			}),
			executor,
		);

		await engine.run();

		expect(app.fileManager.trashFile).toHaveBeenCalledWith(attachmentFile);
		expect(executor.recordExecutionResult).toHaveBeenCalledWith({
			status: "error",
		});
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

	it("folds line breaks out of generated capture target file paths", async () => {
		const engine = new CaptureChoiceEngine(
			createApp(),
			{
				settings: {
					useSelectionAsCaptureValue: false,
					showCaptureNotification: true,
				},
			} as any,
			createChoice({
				captureTo: "Issue\n221",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
				format: {
					enabled: true,
					format: "Capture body",
				},
			}),
			createExecutor(),
		);
		const createFileWithInput = vi.fn().mockResolvedValue({
			path: "Issue 221.md",
			basename: "Issue 221",
			extension: "md",
		});
		(engine as any).createFileWithInput = createFileWithInput;

		await engine.run();

		expect(createFileWithInput).toHaveBeenCalledWith(
			"Issue 221.md",
			"",
			expect.objectContaining({ suppressTemplaterOnCreate: false }),
		);
		expect(setTitleMock).toHaveBeenCalledWith("Issue 221");
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

	it("does not skip configured frontmatter link insertion for canvas file-card capture", async () => {
		vi.mocked(insertFileLinkToActiveView).mockImplementation(() => {
			throw new Error("frontmatter link insertion failed");
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
		} as TFile;
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

		const executor = createExecutor();
		executor.recordExecutionResult = vi.fn();
		const appendLink = {
			enabled: true,
			placement: "inFrontmatter" as const,
			requireActiveFile: true,
			linkType: "link" as const,
			frontmatterProperty: "related",
			frontmatterHandling: "error" as const,
		};
		const engine = new CaptureChoiceEngine(
			app,
			{
				settings: {
					useSelectionAsCaptureValue: false,
					showCaptureNotification: false,
				},
			} as any,
			createChoice({
				appendLink,
				captureToActiveFile: true,
				activeFileWritePosition: "top",
			}),
			executor,
		);

		(engine as any).fileExists = vi.fn(async () => true);
		(engine as any).onFileExists = vi.fn(async () => ({
			file: linkedFile,
			newFileContent: "updated",
			captureContent: "capture",
		}));

		await engine.run();

		expect(app.vault.modify).toHaveBeenCalledWith(linkedFile, "updated");
		expect(executor.recordExecutionResult).toHaveBeenCalledWith({
			status: "success",
			file: linkedFile,
		});
		expect(insertFileLinkToActiveView).toHaveBeenCalledWith(
			app,
			linkedFile,
			expect.objectContaining({
				...appendLink,
				destination: { type: "activeFile" },
			}),
		);
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

	it("does not delete a clipboard attachment after a canvas text-card write if later link insertion fails", async () => {
		vi.mocked(insertFileLinkToActiveView).mockImplementation(() => {
			throw new Error("link insertion failed after canvas write");
		});

		const canvasFile = new TFile();
		canvasFile.path = "Boards/Map.canvas";
		canvasFile.basename = "Map";
		canvasFile.extension = "canvas";
		const attachmentFile = new TFile();
		attachmentFile.path = "Clipboard image.png";
		attachmentFile.basename = "Clipboard image";
		const setTextMock = vi.fn();
		const app = createApp() as any;
		app.workspace.activeLeaf = {
			view: {
				getViewType: () => "canvas",
				file: canvasFile,
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
		app.workspace.getActiveFile = vi.fn(() => canvasFile);
		app.workspace.getActiveViewOfType = vi.fn(() => ({ editor: {} }));
		app.vault.getAbstractFileByPath = vi.fn((path: string) =>
			path === "Clipboard image.png" ? attachmentFile : null,
		);

		const engine = new CaptureChoiceEngine(
			app,
			{
				settings: {
					useSelectionAsCaptureValue: false,
					showCaptureNotification: true,
				},
			} as any,
			createChoice({
				appendLink: true,
				captureToActiveFile: true,
				activeFileWritePosition: "top",
				format: { enabled: true, format: "{{clipboard}}" },
			}),
			createExecutor(),
		);

		await engine.run();

		expect(setTextMock).toHaveBeenCalledWith("![[Clipboard image.png]]");
		expect(insertFileLinkToActiveView).toHaveBeenCalled();
		expect(app.fileManager.trashFile).not.toHaveBeenCalledWith(attachmentFile);
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

describe("CaptureChoiceEngine reserved capture-target variable (security)", () => {
	const makeEngine = (
		choice: Partial<ICaptureChoice>,
		preselected: string | undefined,
	) => {
		const app = createApp();
		const executor = createExecutor();
		if (preselected !== undefined) {
			executor.variables.set(
				QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
				preselected,
			);
		}
		return new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice(choice),
			executor,
		);
	};

	// The reserved variable is attacker-injectable across QuickAdd's trust
	// boundaries (obsidian:// URI, CLI value-<name>=, {{VALUE:__qa.…}} tokens). For
	// a definite-file "Capture to" the configured path is authoritative, so a stray
	// reserved key must NOT redirect the write to an arbitrary note.
	it("ignores an injected target variable for a fixed-file Capture target", async () => {
		const engine = makeEngine({ captureTo: "Inbox.md" }, "Secrets/payload.md");

		const result = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(result).toBe("Inbox.md");
	});

	it("ignores an injected target variable for a definite file target with extension", async () => {
		const engine = makeEngine(
			{ captureTo: "Notes/Daily.md" },
			"Secrets/payload.md",
		);

		const result = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(result).toBe("Notes/Daily.md");
	});

	it("ignores an injected target variable when capturing to the active file", async () => {
		const app = createApp();
		(app.workspace.getActiveFile as any) = vi.fn(() => ({ path: "Active.md" }));
		const executor = createExecutor();
		executor.variables.set(
			QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			"Secrets/payload.md",
		);
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({ captureToActiveFile: true }),
			executor,
		);

		const result = await (engine as any).getFormattedPathToCaptureTo(true);

		expect(result).toBe("Active.md");
	});

	// The legitimate flow: a folder-scoped capture genuinely needs a runtime file
	// selection, supplied by trusted preflight OR a non-interactive CLI value. That
	// selection (inside the scope) is still honoured.
	it("honours a preselected target for a folder-scope Capture target", async () => {
		const engine = makeEngine({ captureTo: "Inbox/" }, "Inbox/Picked.md");

		const result = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(result).toBe("Inbox/Picked.md");
	});

	it("honours a preselected target for a vault-wide Capture target", async () => {
		const engine = makeEngine({ captureTo: "" }, "Anywhere/Picked.md");

		const result = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(result).toBe("Anywhere/Picked.md");
	});

	// A folder scope confines the pick to the folder (mirroring the interactive
	// picker's re-prefix) so an injected out-of-folder value cannot escape it.
	it("confines an out-of-folder preselected target back into the folder", async () => {
		const engine = makeEngine({ captureTo: "Inbox/" }, "Outside/Note.md");

		const result = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(result).toBe("Inbox/Outside/Note.md");
		expect(result).not.toBe("Outside/Note.md");
	});

	// A filter scope without "create if it doesn't exist" only accepts notes the
	// filter matches; an injected out-of-set value is rejected and the normal
	// picker runs instead.
	it("rejects an out-of-set preselected target for a filter scope (create off)", async () => {
		vi.mocked(getMarkdownFilesMatchingFilter).mockReturnValue([
			{ path: "Work/A.md" } as any,
		]);
		const suggestSpy = vi.fn(async () => "Work/A.md");
		(InputSuggester as any).Suggest = suggestSpy;

		const engine = makeEngine({ captureTo: "tag:work" }, "Secrets/Payload.md");

		const result = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(result).toBe("Work/A.md");
		expect(result).not.toBe("Secrets/Payload.md");
		expect(suggestSpy).toHaveBeenCalled();
	});

	it("honours an in-set preselected target for a filter scope (create off)", async () => {
		vi.mocked(getMarkdownFilesMatchingFilter).mockReturnValue([
			{ path: "Work/A.md" } as any,
		]);
		const suggestSpy = vi.fn(async () => "should-not-be-used");
		(InputSuggester as any).Suggest = suggestSpy;

		const engine = makeEngine({ captureTo: "tag:work" }, "Work/A.md");

		const result = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(result).toBe("Work/A.md");
		expect(suggestSpy).not.toHaveBeenCalled();
	});

	// With "create if it doesn't exist" on, a filter scope allows a NEW note name
	// (the picker's "type to create"), so a preselected non-existing path is kept.
	it("honours a preselected NEW note for a filter scope (create on)", async () => {
		vi.mocked(getMarkdownFilesMatchingFilter).mockReturnValue([
			{ path: "Work/A.md" } as any,
		]);
		const app = createApp();
		(app.vault.getAbstractFileByPath as any) = vi.fn(() => null); // nothing exists yet
		const executor = createExecutor();
		executor.variables.set(
			QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			"Work/Fresh.md",
		);
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				captureTo: "tag:work",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
			}),
			executor,
		);

		const result = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(result).toBe("Work/Fresh.md");
	});

	// But it must NOT let an injected value append to an EXISTING note the filter
	// does not match - the interactive picker suppresses that, and it is the
	// arbitrary-note redirect this fix exists to prevent.
	it("rejects a preselected EXISTING unmatched note for a filter scope (create on)", async () => {
		vi.mocked(getMarkdownFilesMatchingFilter).mockReturnValue([
			{ path: "Work/A.md" } as any,
		]);
		const app = createApp();
		// The injected target already exists but is NOT in the matched set.
		(app.vault.getAbstractFileByPath as any) = vi.fn((p: string) =>
			p === "Secrets/Dangerous.md" ? ({ path: p } as any) : null,
		);
		const suggestSpy = vi.fn(async () => "Work/A.md");
		(InputSuggester as any).Suggest = suggestSpy;
		const executor = createExecutor();
		executor.variables.set(
			QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			"Secrets/Dangerous.md",
		);
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				captureTo: "tag:work",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
			}),
			executor,
		);

		const result = await (engine as any).getFormattedPathToCaptureTo(false);

		expect(result).toBe("Work/A.md");
		expect(result).not.toBe("Secrets/Dangerous.md");
		expect(suggestSpy).toHaveBeenCalled();
	});

	// A trailing-space/dot variant normalizes to an existing note before the write,
	// so the existence check must normalize too - otherwise it slips past as "new".
	it("rejects a trailing-space variant of an existing note for a filter scope (create on)", async () => {
		vi.mocked(getMarkdownFilesMatchingFilter).mockReturnValue([]);
		const app = createApp();
		(app.vault.getAbstractFileByPath as any) = vi.fn((p: string) =>
			p === "Secrets/Dangerous.md" ? ({ path: p } as any) : null,
		);
		const suggestSpy = vi.fn(async () => {
			throw "cancelled";
		});
		(InputSuggester as any).Suggest = suggestSpy;
		const executor = createExecutor();
		executor.variables.set(
			QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			"Secrets/Dangerous.md ", // trailing space
		);
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				captureTo: "tag:work",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
			}),
			executor,
		);

		// Rejected -> falls through to the (cancelling) picker, never honoured.
		await expect(
			(engine as any).getFormattedPathToCaptureTo(false),
		).rejects.toBeTruthy();
		expect(suggestSpy).toHaveBeenCalled();
	});

	// Mirror the picker's basename guard: a bare name colliding with an existing
	// note's basename anywhere must not be accepted as a new note.
	it("rejects a basename-colliding preselected for a filter scope (create on)", async () => {
		vi.mocked(getMarkdownFilesMatchingFilter).mockReturnValue([]);
		const app = createApp();
		(app.vault.getAbstractFileByPath as any) = vi.fn(() => null);
		(app.vault.getMarkdownFiles as any) = vi.fn(() => [
			{ path: "Archive/Daily.md", basename: "Daily" },
		]);
		const suggestSpy = vi.fn(async () => {
			throw "cancelled";
		});
		(InputSuggester as any).Suggest = suggestSpy;
		const executor = createExecutor();
		executor.variables.set(QA_INTERNAL_CAPTURE_TARGET_FILE_PATH, "Daily");
		const engine = new CaptureChoiceEngine(
			app,
			{ settings: { useSelectionAsCaptureValue: false } } as any,
			createChoice({
				captureTo: "tag:work",
				createFileIfItDoesntExist: {
					enabled: true,
					createWithTemplate: false,
					template: "",
				},
			}),
			executor,
		);

		await expect(
			(engine as any).getFormattedPathToCaptureTo(false),
		).rejects.toBeTruthy();
		expect(suggestSpy).toHaveBeenCalled();
	});
});
