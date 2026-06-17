import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import type { IChoiceExecutor } from "src/IChoiceExecutor";
import type ICaptureChoice from "src/types/choices/ICaptureChoice";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type ITemplateChoice from "src/types/choices/ITemplateChoice";
import { CommandType } from "src/types/macros/CommandType";
import type { IUserScript } from "src/types/macros/IUserScript";
import { QA_INTERNAL_CAPTURE_TARGET_FILE_PATH } from "src/constants";
import { collectChoiceRequirements } from "./collectChoiceRequirements";

const {
	getMarkdownFilesInFolderMock,
	getMarkdownFilesWithTagMock,
	getMarkdownFilesWithPropertyMock,
	getUserScriptMock,
	getTemplateFileMock,
	isFolderMock,
	logWarningMock,
	logMessageMock,
} = vi.hoisted(() => ({
	getMarkdownFilesInFolderMock: vi.fn(() => []),
	getMarkdownFilesWithTagMock: vi.fn(() => []),
	getMarkdownFilesWithPropertyMock: vi.fn(() => []),
	getUserScriptMock: vi.fn(),
	getTemplateFileMock: vi.fn(() => null),
	isFolderMock: vi.fn(() => false),
	logWarningMock: vi.fn(),
	logMessageMock: vi.fn(),
}));

vi.mock("src/utilityObsidian", () => ({
	getMarkdownFilesInFolder: getMarkdownFilesInFolderMock,
	getMarkdownFilesWithTag: getMarkdownFilesWithTagMock,
	getMarkdownFilesWithProperty: getMarkdownFilesWithPropertyMock,
	getUserScript: getUserScriptMock,
	getTemplateFile: getTemplateFileMock,
	isFolder: isFolderMock,
}));

vi.mock("src/logger/logManager", () => ({
	log: {
		logWarning: logWarningMock,
		logMessage: logMessageMock,
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
		getMarkdownFilesWithPropertyMock.mockReset();
		isFolderMock.mockReset();
		logWarningMock.mockReset();
		getMarkdownFilesInFolderMock.mockReturnValue([]);
		getMarkdownFilesWithTagMock.mockReturnValue([]);
		getMarkdownFilesWithPropertyMock.mockReturnValue([]);
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
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(false);
	});

	it("forces the capture target dropdown for a property:field=value target (issue #466)", async () => {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("property:type=draft"),
		);

		expect(getMarkdownFilesWithPropertyMock).toHaveBeenCalledWith(
			app,
			"type",
			"draft",
			expect.any(Object),
		);
		expect(getMarkdownFilesWithTagMock).not.toHaveBeenCalled();
		expect(getMarkdownFilesInFolderMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(true);
	});

	it("treats a value-less property target as presence mode (undefined value)", async () => {
		await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("property:type"),
		);

		expect(getMarkdownFilesWithPropertyMock).toHaveBeenCalledWith(
			app,
			"type",
			undefined,
			expect.any(Object),
		);
	});

	it("passes pipe filters through to the property query", async () => {
		await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("property:type=draft|folder:Notes"),
		);

		expect(getMarkdownFilesWithPropertyMock).toHaveBeenCalledWith(
			app,
			"type",
			"draft",
			expect.objectContaining({ folder: "Notes" }),
		);
	});

	it("does not force the dropdown for a tokenized property value", async () => {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("property:type={{VALUE}}"),
		);

		expect(getMarkdownFilesWithPropertyMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(false);
	});

	it("does not force the dropdown for a property target missing a field name", async () => {
		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createCaptureChoice("property:"),
		);

		expect(getMarkdownFilesWithPropertyMock).not.toHaveBeenCalled();
		expect(
			requirements.some(
				(requirement) =>
					requirement.id === QA_INTERNAL_CAPTURE_TARGET_FILE_PATH,
			),
		).toBe(false);
	});
});

describe("collectChoiceRequirements - template path format syntax (issue #620)", () => {
	const app = {} as App;
	const plugin = {
		settings: { inputPrompt: "single-line", templateSourceExtensions: ["eta"] },
	} as any;

	function createTemplateChoice(templatePath: string): ITemplateChoice {
		return {
			id: "template-choice",
			name: "Template Choice",
			type: "Template",
			command: false,
			templatePath,
			fileNameFormat: { enabled: false, format: "" },
			folder: {
				enabled: false,
				folders: [],
				chooseWhenCreatingNote: false,
				createInSameFolderAsActiveFile: false,
				chooseFromSubfolders: false,
			},
			appendLink: false,
			openFile: false,
			fileOpening: {
				location: "tab",
				direction: "vertical",
				mode: "default",
				focus: true,
			},
			fileExistsBehavior: { kind: "prompt" },
		} as ITemplateChoice;
	}

	beforeEach(() => {
		getTemplateFileMock.mockReset();
		getTemplateFileMock.mockReturnValue(null);
		logMessageMock.mockReset();
	});

	it("collects a token in the template PATH itself and skips reading the (non-existent) body", async () => {
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		const requirements = await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createTemplateChoice("Templates/{{VALUE:collectionName}} Template.md"),
		);

		expect(requirements).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: "collectionName" }),
			]),
		);
		// A dynamic path can't be resolved at preflight, so the body walk is
		// skipped — getTemplateFile must not be called for a tokenized path.
		expect(getTemplateFileMock).not.toHaveBeenCalled();
	});

	it("still walks the body for a literal (token-free) path", async () => {
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createTemplateChoice("Templates/Note.md"),
		);

		expect(getTemplateFileMock).toHaveBeenCalled();
	});

	it("passes configured source extensions when pre-scanning eta templates", async () => {
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		await collectChoiceRequirements(
			app,
			plugin,
			choiceExecutor,
			createTemplateChoice("Templates/Note.eta"),
		);

		expect(getTemplateFileMock).toHaveBeenCalledWith(
			app,
			"Templates/Note.eta",
			["eta"],
		);
	});

	it("collects a token in a Capture create-with-template path", async () => {
		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>(),
		};

		const captureChoice = {
			...createCaptureChoice("Inbox.md"),
			createFileIfItDoesntExist: {
				enabled: true,
				createWithTemplate: true,
				template: "Templates/{{VALUE:kind}} Template.md",
			},
		} as ICaptureChoice;

		const requirements = await collectChoiceRequirements(
			app,
			{ settings: { inputPrompt: "single-line" } } as any,
			choiceExecutor,
			captureChoice,
		);

		expect(requirements).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "kind" })]),
		);
		// Dynamic path → body not pre-read.
		expect(getTemplateFileMock).not.toHaveBeenCalled();
	});
});
