// @vitest-environment jsdom
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A note the CLI named with `current=` is the run's current note, whatever tab
 * is active while the capture runs. Without one, the current note is the active
 * tab, read when the capture runs, as before `current=` existed.
 */

vi.mock("../quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: { choices: [], migrations: {} },
	QuickAddSettingsTab: class {},
}));

vi.mock("../formatters/captureChoiceFormatter", () => {
	class CaptureChoiceFormatterMock {
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		setPromptRunContext() {}
		setDestinationFile() {}
		setDestinationSourcePath() {}
		setUseSelectionAsCaptureValue() {}
		async formatContentOnly(content: string) {
			return content;
		}
		// Honors the write position the engine hands it, so a test can tell top from bottom.
		async insertFormattedContent(content: string, choice: { activeFileWritePosition?: string }, fileContent: string) {
			const bottom = choice.activeFileWritePosition === "bottom";
			return { content: bottom ? `${fileContent}${content}` : `${content}${fileContent}`, captureContent: content, cursor: { kind: "none" } };
		}
		async formatContentWithFile(content: string, _choice: unknown, cardText: string) {
			return { content: `${cardText}${content}`, captureContent: content, cursor: { kind: "none" } };
		}
		async formatFileName(name: string) {
			return name;
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
		consumeCreatedClipboardAttachmentPaths() {
			return [];
		}
		async withTemplatePropertyCollection<T>(work: () => Promise<T>) {
			return await work();
		}
	}
	return { CaptureChoiceFormatter: CaptureChoiceFormatterMock };
});

vi.mock("../utils/fileLinks", () => ({
	appendFileLinkToDestinationFile: vi.fn(),
	copyFileLinkToClipboard: vi.fn(),
	getAppendLinkDestinationFile: vi.fn(),
}));
vi.mock("../utils/editorInsertion", () => ({
	appendToCurrentLine: vi.fn(() => true),
	insertFileLinkToCurrentNote: vi.fn(),
	insertOnNewLineAbove: vi.fn(() => true),
	insertOnNewLineBelow: vi.fn(() => true),
}));
vi.mock("../utils/vaultQueries", () => ({
	getMarkdownFilesInFolder: vi.fn(async () => []),
	getMarkdownFilesWithTag: vi.fn(async () => []),
	isFolder: vi.fn(() => false),
}));
vi.mock("../utils/fileOpening", () => ({
	openExistingFileTab: vi.fn(() => null),
	openFile: vi.fn(),
}));
vi.mock("../utils/templaterIntegration", () => ({
	overwriteTemplaterOnce: vi.fn(),
	templaterParseTemplate: vi.fn(async (_app: unknown, content: string) => content),
	getTemplater: vi.fn(() => ({})),
	isTemplaterTriggerOnCreateEnabled: vi.fn(() => false),
	createNoteAfterTemplaterTrigger: vi.fn(async (_app: unknown, _path: string, create: () => Promise<unknown>) => create()),
	withTemplaterFileCreationSuppressed: vi.fn(async (_app: unknown, _p: string, run: () => unknown) => await run()),
}));
vi.mock("../utils/frontmatterPropertyLinks", async (importOriginal) => ({
	...(await importOriginal<object>()),
	appendLinkToFrontmatterProperty: vi.fn(),
}));
vi.mock("./canvasCapture", async (importOriginal) => ({
	...(await importOriginal<object>()),
	resolveActiveCanvasCaptureTarget: vi.fn(() => null),
}));
vi.mock("three-way-merge", () => ({ default: vi.fn(() => ({})), __esModule: true }));
vi.mock("src/gui/InputSuggester/inputSuggester", () => ({ default: class InputSuggesterMock {} }));
vi.mock("../main", () => ({ default: class QuickAddMock {} }));

import { TFile, View, type App } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import { appendToCurrentLine, insertFileLinkToCurrentNote, insertOnNewLineBelow } from "../utils/editorInsertion";
import { appendLinkToFrontmatterProperty } from "../utils/frontmatterPropertyLinks";
import { resolveActiveCanvasCaptureTarget } from "./canvasCapture";
import type * as CanvasCapture from "./canvasCapture";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { settingsStore } from "../settingsStore";

const realCanvasCapture = await vi.importActual<typeof CanvasCapture>("./canvasCapture");

function note(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.slice(path.lastIndexOf("/") + 1);
	file.extension = "md";
	file.basename = file.name.replace(/\.md$/, "");
	return file;
}

function canvas(path: string): TFile {
	const file = note(path);
	file.extension = "canvas";
	file.basename = file.name.replace(/\.canvas$/, "");
	return file;
}

const target = note("Daily/Today.md");
const other = note("Other.md");
const board = canvas("Board.canvas");
const otherBoard = canvas("Other.canvas");
const BOARD_JSON = '{"nodes":[{"id":"card","type":"text","text":"Start"}],"edges":[]}';

type Card = { id: string; type: "text"; text: string; setText: ReturnType<typeof vi.fn> };

function harness({
	current, activeEditorFile, activeCanvas = null, configure = () => {}, focusedProperty = null, named = true,
}: {
	current: TFile | null; activeEditorFile: TFile | null;
	/** Whether the caller named `current` (the CLI's `current=`), or it is just the note the run started in. */
	named?: boolean;
	/** A Canvas view in the active leaf with one selected text card. */
	activeCanvas?: { file: TFile; card: Card } | null;
	configure?: (choice: CaptureChoice) => void; focusedProperty?: { file: TFile; key: string } | null;
}) {
	const contents = new Map<string, string>([[target.path, "# Today\n"], [other.path, "# Other\n"], [board.path, BOARD_JSON]]);
	const files = new Map<string, TFile>([[target.path, target], [other.path, other], [board.path, board], [otherBoard.path, otherBoard]]);
	const canvasView = activeCanvas
		? { file: activeCanvas.file, getViewType: () => "canvas", canvas: { selection: new Set([activeCanvas.card]), requestSave: vi.fn() } }
		: null;
	const app = {
		vault: {
			adapter: { exists: vi.fn(async (path: string) => files.has(path)) },
			getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
			read: vi.fn(async (file: TFile) => contents.get(file.path) ?? ""),
			process: vi.fn(async (file: TFile, fn: (content: string) => string) => {
				const next = fn(contents.get(file.path) ?? "");
				contents.set(file.path, next);
				return next;
			}),
			create: vi.fn(),
			createFolder: vi.fn(),
		},
		workspace: {
			// A different note is active in the editor while the run resolves.
			getActiveFile: vi.fn(() => other),
			getActiveViewOfType: vi.fn((type: unknown) =>
				type === View ? canvasView : activeEditorFile ? { file: activeEditorFile, editor: {} } : null),
			getLeavesOfType: vi.fn(() => []),
		},
		fileManager: { getNewFileParent: vi.fn(() => ({ path: "" })) },
	} as unknown as App;
	const executor: IChoiceExecutor = {
		...createChoiceExecutor(),
		recordExecutionResult: vi.fn(),
		signalAbort: vi.fn(),
		variables: new Map<string, unknown>(),
		triggerContext: named ? { activeFile: current, named: true } : { activeFile: current },
		focusedProperty,
	};
	const choice = new CaptureChoice("Here");
	choice.captureToActiveFile = true;
	choice.format = { enabled: true, format: "captured\n" };
	configure(choice);
	const plugin = { settings: { ...settingsStore.getState(), showCaptureNotification: false } } as never;
	return { app, executor, contents, engine: new CaptureChoiceEngine(app, plugin, choice as ICaptureChoice, executor) };
}

describe("CaptureChoiceEngine and the run's current note", () => {
	beforeEach(() => vi.clearAllMocks());

	it("captures into the current note at the top when no editor shows it, not into the active tab", async () => {
		const { engine, executor, contents } = harness({ current: target, activeEditorFile: other });

		await engine.run();

		expect(contents.get(target.path)).toBe("captured\n# Today\n");
		expect(contents.get(other.path)).toBe("# Other\n");
		expect(appendToCurrentLine).not.toHaveBeenCalled();
		expect(executor.recordExecutionResult).toHaveBeenCalledWith({ status: "success", file: target, effect: "changed" });
	});

	it("captures into the active note when the run did not name one, so a macro step's note is used", async () => {
		const { engine, app, executor, contents } = harness({ current: target, activeEditorFile: other, named: false });

		await engine.run();

		expect(appendToCurrentLine).toHaveBeenCalledWith("captured\n", app, other);
		expect(contents.get(target.path)).toBe("# Today\n");
		expect(executor.recordExecutionResult).toHaveBeenCalledWith({ status: "success", file: other, effect: "changed" });
	});

	it("keeps the bottom for a new-line capture whose settings capture to the bottom", async () => {
		const { engine, contents } = harness({
			current: target, activeEditorFile: other,
			configure: (choice) => {
				choice.newLineCapture = { enabled: true, direction: "below" };
				choice.activeFileWritePosition = "bottom";
			},
		});

		await engine.run();

		expect(contents.get(target.path)).toBe("# Today\ncaptured\n");
		expect(insertOnNewLineBelow).not.toHaveBeenCalled();
	});

	it("still writes at the cursor when the active editor shows the current note", async () => {
		const { engine, app, contents } = harness({ current: target, activeEditorFile: target });

		await engine.run();

		expect(appendToCurrentLine).toHaveBeenCalledWith("captured\n", app, target);
		expect(contents.get(target.path)).toBe("# Today\n");
	});

	it("fails like today when the run has no current note, even though a tab is active", async () => {
		const { engine, executor, contents } = harness({ current: null, activeEditorFile: other });

		await engine.run();

		expect(executor.recordExecutionResult).toHaveBeenCalledWith({
			status: "error", reason: "Cannot capture to active file - no active file.",
		});
		expect(contents.get(other.path)).toBe("# Other\n");
	});

	it("appends the link into the current note", async () => {
		const { engine, app, executor } = harness({
			current: target, activeEditorFile: other,
			configure: (choice) => {
				choice.captureToActiveFile = false;
				choice.captureTo = other.path;
				choice.appendLink = { enabled: true, placement: "newLine", requireActiveFile: false };
			},
		});

		await engine.run();

		expect(insertFileLinkToCurrentNote).toHaveBeenCalledWith(app, other, target, expect.objectContaining({ enabled: true }), undefined, true);
		expect(executor.recordExecutionResult).toHaveBeenCalledWith({ status: "success", file: other, effect: "changed" });
	});

	it("ignores a property focused in another note when placing the link", async () => {
		const link = (choice: CaptureChoice) => {
			choice.captureToActiveFile = false;
			choice.captureTo = other.path;
			choice.appendLink = { enabled: true, placement: "newLine", requireActiveFile: true };
		};
		const elsewhere = harness({
			current: target, activeEditorFile: other, configure: link, focusedProperty: { file: other, key: "related" },
		});
		await elsewhere.engine.run();
		expect(appendLinkToFrontmatterProperty).not.toHaveBeenCalled();
		expect(insertFileLinkToCurrentNote).toHaveBeenCalledWith(elsewhere.app, other, target, expect.anything(), undefined, true);

		vi.clearAllMocks();
		const here = harness({
			current: target, activeEditorFile: other, configure: link, focusedProperty: { file: target, key: "related" },
		});
		await here.engine.run();
		expect(appendLinkToFrontmatterProperty).toHaveBeenCalledWith(here.app, { file: target, key: "related" }, other);
		expect(insertFileLinkToCurrentNote).not.toHaveBeenCalled();
	});

	it("keeps a property focused in the note the run started in when no note was named", async () => {
		const { engine, app } = harness({
			current: target, activeEditorFile: other, named: false, focusedProperty: { file: target, key: "related" },
			configure: (choice) => {
				choice.captureToActiveFile = false;
				choice.captureTo = other.path;
				choice.appendLink = { enabled: true, placement: "newLine", requireActiveFile: true };
			},
		});

		await engine.run();

		expect(appendLinkToFrontmatterProperty).toHaveBeenCalledWith(app, { file: target, key: "related" }, other);
		expect(insertFileLinkToCurrentNote).not.toHaveBeenCalled();
	});

	it("fails a cursor capture with no editor when no note was named, instead of writing to the file", async () => {
		const { engine, app, executor, contents } = harness({ current: target, activeEditorFile: null, named: false });
		vi.mocked(appendToCurrentLine).mockReturnValueOnce(false);

		await engine.run();

		expect(appendToCurrentLine).toHaveBeenCalledWith("captured\n", app, other);
		expect(contents.get(other.path)).toBe("# Other\n");
		expect(executor.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({
			status: "error", reason: expect.stringContaining("no active Markdown editor to insert into"),
		}));
	});

	it("consults the active canvas only when the current note is that canvas", async () => {
		await harness({ current: target, activeEditorFile: other }).engine.run();
		expect(resolveActiveCanvasCaptureTarget).not.toHaveBeenCalled();

		const board = note("Board.canvas");
		board.extension = "canvas";
		await harness({ current: board, activeEditorFile: null }).engine.run();
		expect(resolveActiveCanvasCaptureTarget).toHaveBeenCalledTimes(1);
	});

	describe("with a Canvas as the current note", () => {
		const card = (): Card => ({ id: "card", type: "text", text: "Start", setText: vi.fn() });
		const bottom = (choice: CaptureChoice) => { choice.activeFileWritePosition = "bottom"; };
		const refused = expect.objectContaining({ message: "Cannot capture to Canvas 'Board.canvas' - it is not the active view. Open it and select one card." });
		beforeEach(() => vi.mocked(resolveActiveCanvasCaptureTarget).mockImplementation(realCanvasCapture.resolveActiveCanvasCaptureTarget));
		afterEach(() => vi.mocked(resolveActiveCanvasCaptureTarget).mockImplementation(() => null));

		it("never writes text into the Canvas file when another note's editor is active", async () => {
			const { engine, executor, contents } = harness({ current: board, activeEditorFile: other, configure: bottom });

			await engine.run();

			expect(contents.get(board.path)).toBe(BOARD_JSON);
			expect(executor.signalAbort).toHaveBeenCalledWith(refused);
			expect(executor.recordExecutionResult).not.toHaveBeenCalled();
		});

		it("refuses a card selected in another Canvas", async () => {
			const elsewhere = card();
			const { engine, executor, contents } = harness({
				current: board, activeEditorFile: null, activeCanvas: { file: otherBoard, card: elsewhere }, configure: bottom,
			});

			await engine.run();

			expect(elsewhere.setText).not.toHaveBeenCalled();
			expect(contents.get(board.path)).toBe(BOARD_JSON);
			expect(executor.signalAbort).toHaveBeenCalledWith(refused);
			expect(executor.recordExecutionResult).not.toHaveBeenCalled();
		});

		it("writes the selected card when the active Canvas is the current note", async () => {
			const selected = card();
			const { engine, executor, contents } = harness({
				current: board, activeEditorFile: null, activeCanvas: { file: board, card: selected }, configure: bottom,
			});

			await engine.run();

			expect(selected.setText).toHaveBeenCalledWith("Startcaptured\n");
			expect(contents.get(board.path)).toBe(BOARD_JSON);
			expect(executor.recordExecutionResult).toHaveBeenCalledWith({ status: "success", file: board, effect: "changed" });
		});
	});
});
