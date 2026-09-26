import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import type * as ChoiceFileActions from "./choiceFileActions";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { formatContentWithFileMock, getCaptureInsertionEndOffsetMock } = vi.hoisted(() => ({
	formatContentWithFileMock: vi.fn(),
	getCaptureInsertionEndOffsetMock: vi.fn(),
}));

vi.mock("../quickAddSettingsTab", async () => {
	const { engineSettingsMock } = await import("../../tests/helpers/engines/settings");
	return engineSettingsMock();
});

vi.mock("../formatters/captureChoiceFormatter", () => ({
	CaptureChoiceFormatter: class {
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		setPromptRunContext() {}
		setDestinationFile() {}
		setDestinationSourcePath() {}
		setUseSelectionAsCaptureValue() {}
		async withTemplatePropertyCollection<T>(work: () => Promise<T>) {
			return await work();
		}
		async formatContentOnly(content: string) {
			return content;
		}
		async formatContentWithFile(content: string, ...args: unknown[]) {
			const value = getCaptureInsertionEndOffsetMock();
			return {
				content: await formatContentWithFileMock(content, ...args), captureContent: content,
				cursor: typeof value === "number" ? { kind: "offset", source: "defaultEnd", value } : { kind: "none" },
			};
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
	setMarkdownCursorAtOffset: vi.fn(),
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

vi.mock("./choiceFileActions", async (importOriginal) => ({
	...(await importOriginal<typeof ChoiceFileActions>()),
	openChoiceFile: vi.fn(async () => true),
}));

import type { App } from "obsidian";
import { TFile } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { setMarkdownCursorAtOffset } from "../utilityObsidian";

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
	read,
	concurrent,
	formattedFileContent,
}: {
	read: string;
	/** The note's text when the write lands, after edits made while the capture was formatted. */
	concurrent: string;
	formattedFileContent: string;
}) => {
	const filePath = "Daily/Test.md";
	const file = createFile(filePath);
	const disk = { content: read };
	const app = {
		vault: {
			adapter: {
				exists: vi.fn(async () => true),
			},
			getAbstractFileByPath: vi.fn(() => file),
			read: vi.fn(async () => disk.content),
			process: vi.fn(async (_file: TFile, fn: (content: string) => string) => {
				disk.content = fn(concurrent);
				return disk.content;
			}),
			create: vi.fn(),
		},
		workspace: {
			getActiveFile: vi.fn(() => null),
			getActiveViewOfType: vi.fn(() => null),
			getLeavesOfType: vi.fn(() => []),
		},
		fileManager: {
			getNewFileParent: vi.fn(() => ({ path: "" })),
		},
	} as unknown as App;

	const plugin = { settings: { showCaptureNotification: false } } as any;
	const choiceExecutor: IChoiceExecutor = {
		...createChoiceExecutor(),
		execute: vi.fn(),
		recordExecutionResult: vi.fn(),
		variables: new Map<string, unknown>(),
	};
	const engine = new CaptureChoiceEngine(
		app,
		plugin,
		{ ...createCaptureChoice(), openFile: true },
		choiceExecutor,
	);

	formatContentWithFileMock.mockResolvedValue(formattedFileContent);
	getCaptureInsertionEndOffsetMock.mockReturnValue(formattedFileContent.length);

	return { engine, disk, file, choiceExecutor };
};

describe("CaptureChoiceEngine concurrent-edit merge", () => {
	beforeEach(() => {
		formatContentWithFileMock.mockReset();
		getCaptureInsertionEndOffsetMock.mockReset();
		vi.mocked(setMarkdownCursorAtOffset).mockClear();
	});

	it("merges edits made while the capture was formatted and skips cursor placement", async () => {
		const { engine, disk, choiceExecutor } = createEngine({
			read: "alpha\nbeta\ngamma\n",
			concurrent: "alpha changed by sync\nbeta\ngamma\n",
			formattedFileContent: "alpha\nbeta\ngamma\ncaptured ours\n",
		});

		await engine.run();

		expect(disk.content).toBe("alpha changed by sync\nbeta\ngamma\ncaptured ours\n");
		expect(choiceExecutor.recordExecutionResult).toHaveBeenLastCalledWith(
			expect.objectContaining({ status: "success", effect: "changed" }),
		);
		expect(setMarkdownCursorAtOffset).not.toHaveBeenCalled();
	});

	it("refuses to write when concurrent edits conflict", async () => {
		const concurrent = "alpha from sync\nbeta\ngamma\n";
		const { engine, disk, choiceExecutor } = createEngine({
			read: "alpha\nbeta\ngamma\n",
			concurrent,
			formattedFileContent: "alpha from capture\nbeta\ngamma\n",
		});

		await engine.run();

		expect(disk.content).toBe("alpha\nbeta\ngamma\n");
		expect(choiceExecutor.recordExecutionResult).toHaveBeenLastCalledWith(
			expect.objectContaining({ status: "error" }),
		);
		expect(setMarkdownCursorAtOffset).not.toHaveBeenCalled();
	});

	it("reports unchanged when only a concurrent edit changed the note", async () => {
		const read = "alpha\nbeta\ngamma\n";
		const concurrent = "alpha changed by sync\nbeta\ngamma\n";
		const { engine, disk, choiceExecutor } = createEngine({ read, concurrent, formattedFileContent: read });

		await engine.run();

		expect(disk.content).toBe(concurrent);
		expect(choiceExecutor.recordExecutionResult).toHaveBeenLastCalledWith(
			expect.objectContaining({ status: "success", effect: "unchanged" }),
		);
	});

	it("writes the formatted content and places the cursor when the note did not change", async () => {
		const read = "alpha\nbeta\ngamma\n";
		const formattedFileContent = "alpha\nbeta\ngamma\ncaptured ours\n";
		const { engine, disk, file } = createEngine({ read, concurrent: read, formattedFileContent });

		await engine.run();

		expect(disk.content).toBe(formattedFileContent);
		expect(setMarkdownCursorAtOffset).toHaveBeenCalledWith(
			expect.anything(), file, formattedFileContent.length, formattedFileContent,
		);
	});
});
