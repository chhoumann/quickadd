import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A run's current note comes from the executor's trigger context (the note the
 * CLI named with `current=`, or the active tab when the run began), never from
 * the tab that happens to be active while the capture runs.
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
vi.mock("three-way-merge", () => ({ default: vi.fn(() => ({})), __esModule: true }));
vi.mock("src/gui/InputSuggester/inputSuggester", () => ({ default: class InputSuggesterMock {} }));
vi.mock("../main", () => ({ default: class QuickAddMock {} }));

import { TFile, type App } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import { appendToCurrentLine, insertFileLinkToCurrentNote, insertOnNewLineBelow } from "../utils/editorInsertion";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { CaptureChoice } from "../types/choices/CaptureChoice";
import { settingsStore } from "../settingsStore";

function note(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.slice(path.lastIndexOf("/") + 1);
	file.extension = "md";
	file.basename = file.name.replace(/\.md$/, "");
	return file;
}

const target = note("Daily/Today.md");
const other = note("Other.md");

function harness({
	current, activeEditorFile, configure = () => {},
}: { current: TFile | null; activeEditorFile: TFile | null; configure?: (choice: CaptureChoice) => void }) {
	const contents = new Map<string, string>([[target.path, "# Today\n"], [other.path, "# Other\n"]]);
	const files = new Map<string, TFile>([[target.path, target], [other.path, other]]);
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
			getActiveViewOfType: vi.fn(() => activeEditorFile ? { file: activeEditorFile, editor: {} } : null),
			getLeavesOfType: vi.fn(() => []),
		},
		fileManager: { getNewFileParent: vi.fn(() => ({ path: "" })) },
	} as unknown as App;
	const executor: IChoiceExecutor = {
		...createChoiceExecutor(),
		recordExecutionResult: vi.fn(),
		variables: new Map<string, unknown>(),
		triggerContext: { activeFile: current },
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

		expect(insertFileLinkToCurrentNote).toHaveBeenCalledWith(app, other, target, expect.objectContaining({ enabled: true }), undefined);
		expect(executor.recordExecutionResult).toHaveBeenCalledWith({ status: "success", file: other, effect: "changed" });
	});
});
