import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { IUserScript } from "src/types/macros/IUserScript";
import { collectChoiceRequirements } from "./collectChoiceRequirements";

const {
	getMarkdownFilesInFolderMock,
	getMarkdownFilesWithTagMock,
	getUserScriptMock,
	isFolderMock,
	logWarningMock,
} = vi.hoisted(() => ({
	getMarkdownFilesInFolderMock: vi.fn(() => []),
	getMarkdownFilesWithTagMock: vi.fn(() => []),
	getUserScriptMock: vi.fn(),
	isFolderMock: vi.fn(() => false),
	logWarningMock: vi.fn(),
}));

vi.mock("src/utilityObsidian", () => ({
	getMarkdownFilesInFolder: getMarkdownFilesInFolderMock,
	getMarkdownFilesWithTag: getMarkdownFilesWithTagMock,
	getUserScript: getUserScriptMock,
	isFolder: isFolderMock,
}));

vi.mock("src/logger/logManager", () => ({
	log: {
		logWarning: logWarningMock,
	},
}));

function createMacroChoice(script: IUserScript): IMacroChoice {
	return {
		id: "macro-choice",
		name: "Macro Choice",
		type: "Macro",
		command: false,
		runOnStartup: false,
		macro: {
			id: "macro-choice",
			name: "Macro Choice",
			commands: [script],
		},
	};
}

function createCaptureChoice(captureTo: string): ICaptureChoice {
	return {
		id: "capture-choice",
		name: "Capture Choice",
		type: "Capture",
		command: false,
		captureTo,
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
	};
}

describe("collectChoiceRequirements - macro script metadata", () => {
	const app = {} as App;
	const plugin = {} as any;
	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
	};

	const scriptCommand: IUserScript = {
		id: "script-1",
		name: "Script 1",
		type: CommandType.UserScript,
		path: "script.js",
		settings: {},
	};

	beforeEach(() => {
		getMarkdownFilesInFolderMock.mockReset();
		getMarkdownFilesWithTagMock.mockReset();
		getUserScriptMock.mockReset();
		isFolderMock.mockReset();
		logWarningMock.mockReset();
		getMarkdownFilesInFolderMock.mockReturnValue([]);
		getMarkdownFilesWithTagMock.mockReturnValue([]);
		isFolderMock.mockReturnValue(false);
	});

	it("reads quickadd.inputs from function exports", async () => {
		const exported = (() => {}) as ((...args: unknown[]) => unknown) & {
			quickadd?: unknown;
		};
		exported.quickadd = {
			inputs: [{ id: "project", type: "text", label: "Project" }],
		};
		getUserScriptMock.mockResolvedValue(exported);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "project",
					type: "text",
					label: "Project",
					source: "script",
				}),
			]),
		);
	});

	it("reads quickadd.inputs from object exports", async () => {
		getUserScriptMock.mockResolvedValue({
			quickadd: {
				inputs: [{ id: "project", type: "text", label: "Project" }],
			},
		});

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "project",
					type: "text",
					label: "Project",
					source: "script",
				}),
			]),
		);
	});

	it("ignores malformed input entries", async () => {
		const exported = (() => {}) as ((...args: unknown[]) => unknown) & {
			quickadd?: unknown;
		};
		exported.quickadd = {
			inputs: [{ id: "missingType" }, { type: "text" }, null],
		};
		getUserScriptMock.mockResolvedValue(exported);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual([]);
	});

	it("logs a warning when script metadata cannot be inspected", async () => {
		getUserScriptMock.mockRejectedValue(new Error("script load failed"));

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createMacroChoice(scriptCommand),
		);

		expect(requirements).toEqual([]);
		expect(logWarningMock).toHaveBeenCalledWith(
			expect.stringContaining(
				"Preflight could not inspect user script 'script.js'",
			),
		);
	});
});

describe("collectChoiceRequirements - capture targets", () => {
	const app = {} as App;
	const plugin = {
		settings: {
			inputPrompt: "single-line",
			globalVariables: {},
			useSelectionAsCaptureValue: true,
		},
	} as any;
	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
	};

	beforeEach(() => {
		getMarkdownFilesInFolderMock.mockReset();
		getMarkdownFilesWithTagMock.mockReset();
		isFolderMock.mockReset();
		logWarningMock.mockReset();
		getMarkdownFilesInFolderMock.mockReturnValue([]);
		getMarkdownFilesWithTagMock.mockReturnValue([]);
	});

	it("normalizes capture folder paths ending in .md", async () => {
		isFolderMock.mockReturnValue(true);

		await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("Projects.md"),
		);

		expect(getMarkdownFilesInFolderMock).toHaveBeenCalledWith(
			app,
			"Projects/",
		);
	});

	it("does not force capture target dropdown for tokenized file paths", async () => {
		isFolderMock.mockReturnValue(false);

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("Projects/{{VALUE}}.md"),
		);

		expect(getMarkdownFilesInFolderMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === "QA_INTERNAL_CAPTURE_TARGET_FILE_PATH",
			),
		).toBe(false);
	});
});
