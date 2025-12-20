import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";

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
});
