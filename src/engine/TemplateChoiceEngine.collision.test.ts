import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../quickAddSettingsTab", () => {
	const defaultSettings = {
		choices: [],
		inputPrompt: "single-line",
		devMode: false,
		templateFolderPaths: [],
		useSelectionAsCaptureValue: true,
		announceUpdates: "major",
		version: "0.0.0",
		globalVariables: {},
		onePageInputEnabled: false,
		disableOnlineFeatures: true,
		enableRibbonIcon: false,
		showCaptureNotification: true,
		showInputCancellationNotification: true,
		enableTemplatePropertyTypes: false,
		ai: {
			defaultModel: "Ask me",
			defaultSystemPrompt: "",
			promptTemplatesFolderPath: "",
			showAssistant: true,
			providers: [],
		},
		migrations: {
			migrateToMacroIDFromEmbeddedMacro: true,
			useQuickAddTemplateFolder: false,
			incrementFileNameSettingMoveToDefaultBehavior: false,
			consolidateFileExistsBehavior: false,
			mutualExclusionInsertAfterAndWriteToBottomOfFile: false,
			setVersionAfterUpdateModalRelease: false,
			addDefaultAIProviders: false,
			removeMacroIndirection: false,
			migrateFileOpeningSettings: false,
			backfillFileOpeningDefaults: false,
		},
	};

	return {
		DEFAULT_SETTINGS: defaultSettings,
		QuickAddSettingsTab: class {},
	};
});

const {
	formatFileNameMock,
	formatFileContentMock,
	formatTemplatePathMock,
	getAnonymousValueMock,
	templateInsertApplyMock,
	templateInsertConstructorMock,
	templateInsertSetLinkToCurrentFileBehaviorMock,
} = vi.hoisted(() => {
		const formatName =
			vi.fn<(format: string, prompt: string) => Promise<string>>();
		const formatContent = vi
			.fn<(...args: unknown[]) => Promise<string>>()
			.mockResolvedValue("");
		// Identity by default (literal paths); tests override to simulate a token
		// that resolves to a different extension (issue #620).
		const formatPath = vi
			.fn<(input: string) => Promise<string>>()
			.mockImplementation(async (input: string) => input);

		return {
			formatFileNameMock: formatName,
			formatFileContentMock: formatContent,
			formatTemplatePathMock: formatPath,
			getAnonymousValueMock: vi.fn<() => string | undefined>(),
			templateInsertApplyMock: vi.fn(),
			templateInsertConstructorMock: vi.fn(),
			templateInsertSetLinkToCurrentFileBehaviorMock: vi.fn(),
		};
	});

vi.mock("../formatters/completeFormatter", () => {
	class CompleteFormatterMock {
		constructor() {}
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		setTargetFolderPath() {}
		async formatFileName(format: string, prompt: string) {
			return formatFileNameMock(format, prompt);
		}
		async formatFileContent(...args: unknown[]) {
			return await formatFileContentMock(...args);
		}
		async formatTemplateFilePath(input: string) {
			return formatTemplatePathMock(input);
		}
		getAnonymousValue() {
			return getAnonymousValueMock();
		}
		getAndClearTemplatePropertyVars() {
			return new Map<string, unknown>();
		}
	}

	return {
		CompleteFormatter: CompleteFormatterMock,
		formatFileNameMock,
		formatFileContentMock,
		formatTemplatePathMock,
	};
});

vi.mock("../utilityObsidian", () => ({
	getTemplater: vi.fn(() => ({})),
	overwriteTemplaterOnce: vi.fn(),
	getAllFolderPathsInVault: vi.fn(() => []),
	insertFileLinkToActiveView: vi.fn(),
	openExistingFileTab: vi.fn(() => null),
	openFile: vi.fn(),
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: {
		Suggest: vi.fn(),
	},
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

vi.mock("./TemplateInsertEngine", () => {
	class TemplateInsertEngineMock {
		constructor(...args: unknown[]) {
			templateInsertConstructorMock(...args);
		}

		setLinkToCurrentFileBehavior(behavior: "required" | "optional") {
			templateInsertSetLinkToCurrentFileBehaviorMock(behavior);
		}

		async apply() {
			return await templateInsertApplyMock();
		}
	}

	return { TemplateInsertEngine: TemplateInsertEngineMock };
});

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

import { TFile, TFolder, type App } from "obsidian";
import GenericSuggester from "../gui/GenericSuggester/genericSuggester";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { settingsStore } from "../settingsStore";
import { getPromptModes } from "../template/fileExistsPolicy";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { TemplateChoiceEngine } from "./TemplateChoiceEngine";

const defaultSettingsState = structuredClone(settingsStore.getState());

const createTemplateChoice = (): ITemplateChoice => ({
	name: "Test Template Choice",
	id: "choice-id",
	type: "Template",
	command: false,
	templatePath: "Templates/Test.md",
	folder: {
		enabled: false,
		folders: [],
		chooseWhenCreatingNote: false,
		createInSameFolderAsActiveFile: false,
		chooseFromSubfolders: false,
	},
	fileNameFormat: { enabled: false, format: "{{VALUE}}" },
	appendLink: false,
	openFile: false,
	fileOpening: {
		location: "tab",
		direction: "vertical",
		mode: "source",
		focus: false,
	},
	fileExistsBehavior: { kind: "prompt" },
});

const createExistingFile = (path: string, extension = "md") => {
	const file = new TFile();
	file.path = path;
	file.name = path.split("/").pop() ?? path;
	file.extension = extension;
	file.basename = file.name.replace(new RegExp(`\\.${extension}$`), "");
	return file;
};

const createExistingFolder = (path: string) => {
	const folder = new TFolder();
	folder.path = path;
	folder.name = path.split("/").pop() ?? path;
	return folder;
};

const createEngine = () => {
	const app = {
		workspace: {
			getActiveFile: vi.fn(() => null),
		},
		fileManager: {
			getNewFileParent: vi.fn(() => ({ path: "" })),
		},
		vault: {
			getRoot: vi.fn(() => ({ path: "" })),
			adapter: {
				exists: vi.fn(async () => false),
			},
			getAbstractFileByPath: vi.fn(),
			getFiles: vi.fn(() => []),
			createFolder: vi.fn(),
			create: vi.fn(),
			modify: vi.fn(),
		},
	} as unknown as App;

	const choiceExecutor: IChoiceExecutor = {
		execute: vi.fn(),
		variables: new Map<string, unknown>(),
		signalAbort: vi.fn(),
		consumeAbortSignal: vi.fn(),
	};

	const plugin = { settings: settingsStore.getState() } as any;
	const engine = new TemplateChoiceEngine(
		app,
		plugin,
		createTemplateChoice(),
		choiceExecutor,
	);

	formatFileNameMock.mockResolvedValue("Test Template");
	formatFileContentMock.mockResolvedValue("");

	return { app, engine, choiceExecutor, plugin };
};

describe("TemplateChoiceEngine collision behavior", () => {
	beforeEach(() => {
		settingsStore.setState(structuredClone(defaultSettingsState));
		formatFileNameMock.mockReset();
		formatFileContentMock.mockReset();
		formatTemplatePathMock.mockReset();
		formatTemplatePathMock.mockImplementation(async (input: string) => input);
		getAnonymousValueMock.mockReset();
		templateInsertApplyMock.mockReset();
		templateInsertConstructorMock.mockReset();
		templateInsertSetLinkToCurrentFileBehaviorMock.mockReset();
		vi.mocked(GenericSuggester.Suggest).mockReset();
	});

	it("uses the RESOLVED template path for both the target extension and the read (issue #620)", async () => {
		const { app, engine } = createEngine();
		// Raw path carries a token that resolves to a .canvas template.
		engine.choice.templatePath = "Templates/{{VALUE:type}}";
		formatFileNameMock.mockResolvedValue("My Board");
		formatTemplatePathMock.mockResolvedValueOnce("Templates/Board.canvas");
		engine.choice.fileExistsBehavior = { kind: "prompt" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(
			false,
		);

		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						filePath: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createExistingFile("My Board.canvas"));

		await engine.run();

		// Target extension comes from the resolved path (.canvas, not the raw
		// token's default .md), and the resolved path is what gets read.
		expect(createSpy).toHaveBeenCalledWith(
			"My Board.canvas",
			"Templates/Board.canvas",
		);
	});

	it("folds line breaks out of generated file paths before creating notes", async () => {
		const { app, engine } = createEngine();
		formatFileNameMock.mockResolvedValue("Issue 221\nTitle");
		engine.choice.fileExistsBehavior = { kind: "prompt" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(
			false,
		);

		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						filePath: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createExistingFile("Issue 221 Title.md"));

		await engine.run();

		expect(app.vault.adapter.exists).toHaveBeenCalledWith(
			"Issue 221 Title.md",
		);
		expect(createSpy).toHaveBeenCalledWith(
			"Issue 221 Title.md",
			engine.choice.templatePath,
		);
	});

	it("uses normalized generated paths for vault-relative routing", async () => {
		const { app, engine } = createEngine();
		formatFileNameMock.mockResolvedValue("Projects\n/Issue 221");
		engine.choice.fileExistsBehavior = { kind: "prompt" };

		(app.fileManager.getNewFileParent as ReturnType<typeof vi.fn>).mockReturnValue(
			createExistingFolder("Default"),
		);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockImplementation(
			(path: string) => path === "Projects" ? createExistingFolder("Projects") : null,
		);
		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(
			false,
		);

		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						filePath: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createExistingFile("Projects/Issue 221.md"));

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"Projects/Issue 221.md",
			engine.choice.templatePath,
		);
	});

	it("prompts before applying increment mode when auto behavior is off", async () => {
		const { app, engine } = createEngine();
		const existingFile = createExistingFile("Test Template.md");

		engine.choice.fileExistsBehavior = { kind: "prompt" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue("doNothing");
		const createSpy = vi.spyOn(
			engine as unknown as {
				createFileWithTemplate: (
					filePath: string,
					templatePath: string,
				) => Promise<TFile | null>;
			},
			"createFileWithTemplate",
		);

		await engine.run();

		expect(GenericSuggester.Suggest).toHaveBeenCalledWith(
			app,
			expect.arrayContaining([
				getPromptModes().find((mode) => mode.id === "increment")?.label,
				getPromptModes().find((mode) => mode.id === "duplicateSuffix")?.label,
			]),
			expect.arrayContaining(["appendBottom", "increment", "duplicateSuffix"]),
			"If the target file already exists",
		);
		expect(createSpy).not.toHaveBeenCalled();
		expect(app.vault.adapter.exists).toHaveBeenCalledWith("Test Template.md");
	});

	it("creates an incremented file from the original target after prompting", async () => {
		const { app, engine } = createEngine();
		const createdFile = createExistingFile("Test Template1.md");

		engine.choice.fileExistsBehavior = { kind: "prompt" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "Test Template.md",
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue("increment");

		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						filePath: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createdFile);

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"Test Template1.md",
			engine.choice.templatePath,
		);
	});

	it("creates a duplicate-suffix file from the original target after prompting", async () => {
		const { app, engine } = createEngine();
		const createdFile = createExistingFile("Test Template (1).md");

		engine.choice.fileExistsBehavior = { kind: "prompt" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "Test Template.md",
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue("duplicateSuffix");

		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						filePath: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createdFile);

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"Test Template (1).md",
			engine.choice.templatePath,
		);
	});

	it("allows create-another-file modes when the collision target resolves to a folder", async () => {
		const { app, engine } = createEngine();
		const existingFolder = createExistingFolder("Test Template.md");
		const createdFile = createExistingFile("Test Template (1).md");

		engine.choice.fileExistsBehavior = { kind: "prompt" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "Test Template.md",
		);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFolder,
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue("duplicateSuffix");

		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						filePath: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createdFile);

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"Test Template (1).md",
			engine.choice.templatePath,
		);
	});

	it("increments automatically when auto behavior is on", async () => {
		const { app, engine } = createEngine();
		const createdFile = createExistingFile("Test Template1.md");

		engine.choice.fileExistsBehavior = { kind: "apply", mode: "increment" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "Test Template.md",
		);

		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						filePath: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createdFile);

		await engine.run();

		expect(GenericSuggester.Suggest).not.toHaveBeenCalled();
		expect(createSpy).toHaveBeenCalledWith(
			"Test Template1.md",
			engine.choice.templatePath,
		);
	});

	it("applies duplicate suffix automatically when auto behavior is on", async () => {
		const { app, engine } = createEngine();
		const createdFile = createExistingFile("Test Template (1).md");

		engine.choice.fileExistsBehavior = {
			kind: "apply",
			mode: "duplicateSuffix",
		};

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockImplementation(
			async (path: string) => path === "Test Template.md",
		);

		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						filePath: string,
						templatePath: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(createdFile);

		await engine.run();

		expect(GenericSuggester.Suggest).not.toHaveBeenCalled();
		expect(createSpy).toHaveBeenCalledWith(
			"Test Template (1).md",
			engine.choice.templatePath,
		);
	});

	it.each([
		["appendTop", "top"],
		["appendBottom", "bottom"],
	] as const)(
		"delegates markdown %s collisions to TemplateInsertEngine",
		async (mode, position) => {
			const { app, choiceExecutor, engine, plugin } = createEngine();
			const existingFile = createExistingFile("Test Template.md");
			engine.choice.fileExistsBehavior = { kind: "apply", mode };

			(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(
				true,
			);
			(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
				existingFile,
			);
			templateInsertApplyMock.mockResolvedValue(existingFile);

			const rawAppendSpy = vi.spyOn(
				engine as unknown as {
					appendToFileWithTemplate: () => Promise<TFile | null>;
				},
				"appendToFileWithTemplate",
			);

			await engine.run();

			expect(rawAppendSpy).not.toHaveBeenCalled();
			expect(templateInsertConstructorMock).toHaveBeenCalledWith(
				app,
				plugin,
				existingFile,
				engine.choice.templatePath,
				position,
				choiceExecutor,
				engine.choice.templatePath,
			);
			expect(templateInsertSetLinkToCurrentFileBehaviorMock).toHaveBeenCalledWith(
				"required",
			);
			expect(templateInsertApplyMock).toHaveBeenCalledTimes(1);
		},
	);

	it("carries the resolved anonymous VALUE into markdown append collisions", async () => {
		const { app, choiceExecutor, engine } = createEngine();
		const existingFile = createExistingFile("Test Template.md");
		engine.choice.fileExistsBehavior = { kind: "apply", mode: "appendBottom" };
		getAnonymousValueMock.mockReturnValue("Prompted file name");

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(
			true,
		);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);
		templateInsertApplyMock.mockImplementation(async () => {
			expect(choiceExecutor.variables.get("value")).toBe("Prompted file name");
			return existingFile;
		});

		await engine.run();

		expect(choiceExecutor.variables.has("value")).toBe(false);
		expect(templateInsertApplyMock).toHaveBeenCalledTimes(1);
	});

	it("preserves optional LINKCURRENT behavior when append-link does not require an active file", async () => {
		const { app, engine } = createEngine();
		const existingFile = createExistingFile("Test Template.md");
		engine.choice.fileExistsBehavior = { kind: "apply", mode: "appendBottom" };
		engine.choice.appendLink = {
			enabled: true,
			requireActiveFile: false,
			placement: "newLine",
			destination: { type: "activeFile" },
		};

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(
			true,
		);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);
		templateInsertApplyMock.mockResolvedValue(existingFile);

		await engine.run();

		expect(templateInsertSetLinkToCurrentFileBehaviorMock).toHaveBeenCalledWith(
			"optional",
		);
	});

	it("refuses to append a template to a canvas file (would corrupt JSON)", async () => {
		const { app, engine } = createEngine();
		const existingFile = createExistingFile("Test Board.canvas", "canvas");
		engine.choice.fileExistsBehavior = { kind: "apply", mode: "appendTop" };

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(
			true,
		);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);

		const rawAppendSpy = vi
			.spyOn(
				engine as unknown as {
					appendToFileWithTemplate: (
						file: TFile,
						templatePath: string,
						position: "top" | "bottom",
					) => Promise<TFile | null>;
				},
				"appendToFileWithTemplate",
			)
			.mockResolvedValue(existingFile);

		await engine.run();

		// Append must NOT proceed through either the raw-concat path or the
		// markdown insert engine — both would corrupt the canvas JSON.
		expect(rawAppendSpy).not.toHaveBeenCalled();
		expect(templateInsertConstructorMock).not.toHaveBeenCalled();
		expect(templateInsertSetLinkToCurrentFileBehaviorMock).not.toHaveBeenCalled();
		expect(app.vault.modify).not.toHaveBeenCalled();
	});

	it("falls back to prompt behavior when fileExistsBehavior is missing at runtime", async () => {
		const { app, engine } = createEngine();
		const existingFile = createExistingFile("Test Template.md");

		(engine.choice as any).fileExistsBehavior = undefined;

		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);
		(app.vault.getAbstractFileByPath as ReturnType<typeof vi.fn>).mockReturnValue(
			existingFile,
		);
		vi.mocked(GenericSuggester.Suggest).mockResolvedValue("doNothing");

		await engine.run();

		expect(GenericSuggester.Suggest).toHaveBeenCalledTimes(1);
		expect(engine.choice.fileExistsBehavior).toEqual({ kind: "prompt" });
	});
});
