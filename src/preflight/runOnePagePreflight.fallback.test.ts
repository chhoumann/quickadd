import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { runOnePagePreflight } from "./runOnePagePreflight";
import { MacroAbortError } from "../errors/MacroAbortError";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";

const { logWarningMock } = vi.hoisted(() => ({
	logWarningMock: vi.fn(),
}));

vi.mock("src/logger/logManager", () => ({
	log: {
		logWarning: logWarningMock,
		logError: vi.fn(),
		logMessage: vi.fn(),
	},
}));

// The modal's close promise is the error source under test: a plain Error
// stands in for any unexpected failure, "cancelled" and MacroAbortError are
// the two cancellation shapes that must rethrow without a warning.
let modalOutcome: () => Promise<Record<string, string>>;

vi.mock("./OnePageInputModal", () => ({
	OnePageInputModal: class {
		get waitForClose() {
			return modalOutcome();
		}
	},
}));

vi.mock("src/quickAddSettingsTab", () => ({
	QuickAddSettingsTab: class {},
}));

vi.mock("src/main", () => ({
	__esModule: true,
	default: class QuickAddMock {},
}));

vi.mock("obsidian-dataview", () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
}));

vi.mock("src/utilityObsidian", async () => {
	const { TFile: TFileCls } = await import("obsidian");
	return {
		getMarkdownFilesInFolder: vi.fn(() => []),
		getMarkdownFilesWithTag: vi.fn(() => []),
		getUserScript: vi.fn(),
		isFolder: vi.fn(() => false),
		getTemplateFile: vi.fn((app: App, path: string) => {
			const f = app.vault.getAbstractFileByPath(path);
			return f instanceof TFileCls ? f : null;
		}),
	};
});

const createApp = () =>
	({
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(null),
		},
		vault: {
			getAbstractFileByPath: vi.fn().mockReturnValue(null),
		},
	}) as unknown as App;

// A capture choice with one unresolved {{VALUE}} so the modal always opens.
const createChoice = (): ICaptureChoice => ({
	id: "fallback-choice-id",
	name: "Fallback Choice",
	type: "Capture",
	command: false,
	captureTo: "Inbox.md",
	captureToActiveFile: true,
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
});

const createExecutor = (): IChoiceExecutor => ({
	execute: vi.fn(),
	variables: new Map<string, unknown>(),
});

const createPlugin = () =>
	({
		settings: {
			inputPrompt: "single-line",
			globalVariables: {},
			useSelectionAsCaptureValue: false,
		},
	}) as never;

const run = (executor: IChoiceExecutor = createExecutor()) =>
	runOnePagePreflight(createApp(), createPlugin(), executor, createChoice());

describe("runOnePagePreflight fallback warning", () => {
	beforeEach(() => {
		logWarningMock.mockReset();
	});

	it("warns and returns false when the preflight fails unexpectedly", async () => {
		modalOutcome = () => Promise.reject(new Error("collection exploded"));
		await expect(run()).resolves.toBe(false);
		expect(logWarningMock).toHaveBeenCalledTimes(1);
		expect(logWarningMock.mock.calls[0][0]).toContain("Fallback Choice");
		expect(logWarningMock.mock.calls[0][0]).toContain("collection exploded");
	});

	it("does not warn on a remote run, where session teardown rejects with a plain Error", async () => {
		// The remote path never opens the modal; a lazy thunk avoids an
		// unhandled rejection from a promise nothing awaits.
		modalOutcome = () => Promise.reject(new Error("Interactive session ended"));
		const executor = createExecutor();
		executor.promptProvider = {} as never;
		await expect(run(executor)).resolves.toBe(false);
		expect(logWarningMock).not.toHaveBeenCalled();
	});

	it("rethrows the modal's 'cancelled' rejection without warning", async () => {
		modalOutcome = () => Promise.reject("cancelled");
		await expect(run()).rejects.toBe("cancelled");
		expect(logWarningMock).not.toHaveBeenCalled();
	});

	it("rethrows a MacroAbortError without warning", async () => {
		const abort = new MacroAbortError("Input cancelled by user");
		modalOutcome = () => Promise.reject(abort);
		await expect(run()).rejects.toBe(abort);
		expect(logWarningMock).not.toHaveBeenCalled();
	});
});
