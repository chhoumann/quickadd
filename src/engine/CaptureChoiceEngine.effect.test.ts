import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What a Capture run reports it did to the vault (#1615).
 *
 * The claim has to come from the FILE, not from the payload. A capture whose formatted
 * payload is empty deliberately leaves the note untouched — but the same empty payload
 * can still legitimately create a note via "create file if it doesn't exist", and a
 * non-empty payload can still write bytes identical to what was already there. Every
 * case below is one of those, so a payload-derived flag would fail at least one of them.
 */

vi.mock("../quickAddSettingsTab", () => ({
	DEFAULT_SETTINGS: { choices: [], migrations: {} },
	QuickAddSettingsTab: class {},
}));

const { formatted } = vi.hoisted(() => ({ formatted: { value: "" } }));

vi.mock("../formatters/captureChoiceFormatter", () => {
	class CaptureChoiceFormatterMock {
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		setPromptRunContext() {}
		setDestinationFile() {}
		setDestinationSourcePath() {}
		setUseSelectionAsCaptureValue() {}
		async formatContentOnly() {
			return formatted.value;
		}
		// The engine's second pass: splice the payload into the file. An empty payload
		// yields the file back unchanged, which is what the real formatter does.
		async formatContentWithFile(content: string, _choice: unknown, file: string) {
			return content.trim() ? `${file}${content}` : file;
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

vi.mock("../utilityObsidian", () => ({
	appendToCurrentLine: vi.fn(),
	getMarkdownFilesInFolder: vi.fn(async () => []),
	getMarkdownFilesWithTag: vi.fn(async () => []),
	insertFileLinkToActiveView: vi.fn(),
	insertOnNewLineAbove: vi.fn(),
	insertOnNewLineBelow: vi.fn(),
	isFolder: vi.fn(() => false),
	openExistingFileTab: vi.fn(() => null),
	openFile: vi.fn(),
	overwriteTemplaterOnce: vi.fn(),
	templaterParseTemplate: vi.fn(async (_app: unknown, content: string) => content),
	getTemplater: vi.fn(() => ({})),
	isTemplaterTriggerOnCreateEnabled: vi.fn(() => false),
	waitForTemplaterTriggerOnCreateToComplete: vi.fn(async () => {}),
	withTemplaterFileCreationSuppressed: vi.fn(async (_app: unknown, _p: string, run: () => unknown) => await run()),
}));

vi.mock("three-way-merge", () => ({ default: vi.fn(() => ({})), __esModule: true }));
vi.mock("src/gui/InputSuggester/inputSuggester", () => ({
	default: class InputSuggesterMock {},
}));
vi.mock("../main", () => ({ default: class QuickAddMock {} }));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

import { TFile, type App } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { settingsStore } from "../settingsStore";

function createTestFile(path: string): TFile {
	const file = new TFile();
	file.path = path;
	file.name = path.slice(path.lastIndexOf("/") + 1);
	file.extension = file.name.slice(file.name.lastIndexOf(".") + 1);
	file.basename = file.name.replace(/\.[^.]+$/, "");
	return file;
}

const createChoice = (): ICaptureChoice => ({
	name: "Inbox",
	id: "capture-effect",
	type: "Capture",
	command: false,
	captureTo: "Inbox.md",
	captureToActiveFile: false,
	createFileIfItDoesntExist: {
		enabled: false,
		createWithTemplate: false,
		template: "",
	},
	format: { enabled: true, format: "{{VALUE}}" },
	insertAfter: {
		enabled: false,
		after: "",
		insertAtEnd: false,
		considerSubsections: false,
		createIfNotFound: false,
		createIfNotFoundLocation: "top",
	},
	prepend: false,
	appendLink: false,
	task: false,
	openFile: false,
	fileOpening: {},
} as unknown as ICaptureChoice);

function harness({ exists, existing }: { exists: boolean; existing: string }) {
	const captureFile = createTestFile("Inbox.md");
	const created: Array<{ path: string; content: string }> = [];
	const app = {
		vault: {
			adapter: { exists: vi.fn(async () => exists) },
			getAbstractFileByPath: vi.fn(() => (exists ? captureFile : null)),
			read: vi.fn(async () => existing),
			modify: vi.fn(),
			create: vi.fn(async (path: string, content: string) => {
				created.push({ path, content });
				return captureFile;
			}),
			createFolder: vi.fn(),
		},
		workspace: {
			getActiveFile: vi.fn(() => null),
			getActiveViewOfType: vi.fn(() => null),
		},
		fileManager: { getNewFileParent: vi.fn(() => ({ path: "" })) },
	} as unknown as App;

	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		recordExecutionResult: vi.fn(),
		variables: new Map<string, unknown>(),
	} as unknown as IChoiceExecutor;

	const plugin = {
		settings: { ...settingsStore.getState(), showCaptureNotification: false },
	} as never;

	const choice = createChoice();
	return {
		app,
		choice,
		choiceExecutor,
		captureFile,
		created,
		engine: new CaptureChoiceEngine(app, plugin, choice, choiceExecutor),
	};
}

const recordedEffect = (executor: IChoiceExecutor) => {
	const calls = (executor.recordExecutionResult as ReturnType<typeof vi.fn>).mock
		.calls;
	return calls.at(-1)?.[0];
};

describe("CaptureChoiceEngine reports what it did to the vault (#1615)", () => {
	beforeEach(() => {
		formatted.value = "";
		vi.clearAllMocks();
	});

	// The exact shape from the issue: an empty {{VALUE}} answer. Before this, the run
	// answered `verified:true` over a byte-identical note.
	it("reports 'unchanged' when an empty payload leaves an existing note alone", async () => {
		const { engine, choiceExecutor, captureFile } = harness({
			exists: true,
			existing: "# Inbox\n",
		});

		await engine.run();

		expect(recordedEffect(choiceExecutor)).toEqual({
			status: "success",
			file: captureFile,
			effect: "unchanged",
		});
	});

	it("reports 'changed' when the payload actually lands", async () => {
		formatted.value = "- a real line";
		const { engine, choiceExecutor } = harness({
			exists: true,
			existing: "# Inbox\n",
		});

		await engine.run();

		expect(recordedEffect(choiceExecutor)).toMatchObject({ effect: "changed" });
	});

	// The counterexample that kills a payload-derived flag: the payload is empty, so a
	// `!captureIsNoOp` predicate would say "unchanged" — but a note really was created.
	it("reports 'created' when an empty payload still creates the note", async () => {
		const { engine, choice, choiceExecutor, created } = harness({
			exists: false,
			existing: "",
		});
		choice.createFileIfItDoesntExist = {
			enabled: true,
			createWithTemplate: false,
			template: "",
		};

		await engine.run();

		expect(created).toHaveLength(1);
		expect(recordedEffect(choiceExecutor)).toMatchObject({ effect: "created" });
	});
});
