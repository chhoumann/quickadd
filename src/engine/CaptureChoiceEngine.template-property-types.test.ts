import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile, TFolder } from "obsidian";
import { TFolder as ObsidianTFolder } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";

vi.mock("../quickAddSettingsTab", () => {
	const defaultSettings = {
		choices: [],
		inputPrompt: "single-line",
		devMode: false,
		templateFolderPath: "",
		announceUpdates: "all",
		version: "0.0.0",
		globalVariables: {},
		onePageInputEnabled: false,
		disableOnlineFeatures: true,
		enableRibbonIcon: false,
		showCaptureNotification: false,
		showInputCancellationNotification: true,
		enableTemplatePropertyTypes: true,
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
			mutualExclusionInsertAfterAndWriteToBottomOfFile: false,
			setVersionAfterUpdateModalRelease: false,
			addDefaultAIProviders: false,
			removeMacroIndirection: false,
			migrateFileOpeningSettings: false,
		},
	};

	return {
		DEFAULT_SETTINGS: defaultSettings,
		QuickAddSettingsTab: class {},
	};
});

vi.mock("src/gui/InputSuggester/inputSuggester", () => ({
	default: class {
		static Suggest = vi.fn().mockResolvedValue("");
	},
}));

vi.mock("src/gui/GenericSuggester/genericSuggester", () => ({
	__esModule: true,
	default: class {
		static Suggest = vi.fn().mockResolvedValue("");
	},
}));

vi.mock("src/gui/InputPrompt", () => ({
	__esModule: true,
	default: class {
		factory() {
			return {
				Prompt: vi.fn().mockResolvedValue(""),
				PromptWithContext: vi.fn().mockResolvedValue(""),
			};
		}
	},
}));

vi.mock("src/gui/GenericInputPrompt/GenericInputPrompt", () => ({
	__esModule: true,
	default: class {},
}));

vi.mock("src/gui/VDateInputPrompt/VDateInputPrompt", () => ({
	__esModule: true,
	default: {
		Prompt: vi.fn().mockResolvedValue(""),
	},
}));

vi.mock("src/gui/MathModal", () => ({
	__esModule: true,
	MathModal: {
		Prompt: vi.fn().mockResolvedValue(""),
	},
}));

vi.mock("../engine/SingleInlineScriptEngine", () => ({
	__esModule: true,
	SingleInlineScriptEngine: class {
		public params = { variables: {} as Record<string, unknown> };
		async runAndGetOutput() {
			return "";
		}
	},
}));

vi.mock("../engine/SingleMacroEngine", () => ({
	__esModule: true,
	SingleMacroEngine: class {
		async runAndGetOutput() {
			return "";
		}
	},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn().mockReturnValue(null),
}));

vi.mock("../gui/choiceList/ChoiceView.svelte", () => ({
	default: class {},
}));

vi.mock("../utilityObsidian", () => ({
	appendToCurrentLine: vi.fn(),
	getMarkdownFilesInFolder: vi.fn().mockResolvedValue([]),
	getMarkdownFilesWithTag: vi.fn().mockResolvedValue([]),
	insertFileLinkToActiveView: vi.fn(),
	insertOnNewLineAbove: vi.fn(),
	insertOnNewLineBelow: vi.fn(),
	isTemplaterTriggerOnCreateEnabled: vi.fn().mockReturnValue(false),
	jumpToNextTemplaterCursorIfPossible: vi.fn().mockResolvedValue(undefined),
	isFolder: vi.fn().mockReturnValue(false),
	openExistingFileTab: vi.fn().mockReturnValue(false),
	openFile: vi.fn(),
	overwriteTemplaterOnce: vi.fn().mockResolvedValue(undefined),
	templaterParseTemplate: vi.fn(async (_app, content) => content),
	waitForFileToStopChanging: vi.fn().mockResolvedValue(undefined),
	getTemplater: vi.fn(() => ({})),
}));

describe("CaptureChoiceEngine template property types", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		(global as any).navigator = {
			clipboard: {
				readText: vi.fn().mockResolvedValue(""),
			},
		};
	});

	it("post-processes capture frontmatter arrays into YAML lists", async () => {
		const targetPath = "Journal/Test.md";
		const createdContent: Record<string, string> = {};
		let writtenContent = "";
		let appliedFrontmatter: Record<string, unknown> | undefined;

		const folder = { path: "Journal" } as unknown as TFolder;
		if (typeof ObsidianTFolder === "function") {
			Object.setPrototypeOf(folder as unknown as object, ObsidianTFolder.prototype);
		}

		const processFrontMatter = vi.fn(async (_file: TFile, updater: (frontmatter: Record<string, unknown>) => void) => {
			const fm: Record<string, unknown> = { tags: "foo,bar" };
			updater(fm);
			appliedFrontmatter = fm;
		});

		const tFile = {
			path: targetPath,
			name: "Test.md",
			basename: "Test",
			extension: "md",
		} as unknown as TFile;

		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async (path: string) => {
						if (path === targetPath) return false;
						if (path === "Journal") return true;
						return false;
					}),
				},
				getAbstractFileByPath: vi.fn((path: string) => {
					if (path === "Journal") return folder;
					return null;
				}),
				createFolder: vi.fn(),
				create: vi.fn(async (path: string, content: string) => {
					createdContent[path] = content;
					writtenContent = content;
					return tFile;
				}),
				read: vi.fn(async (file: TFile) => createdContent[file.path] ?? ""),
				modify: vi.fn(async (_file: TFile, content: string) => {
					writtenContent = content;
					createdContent[_file.path] = content;
				}),
				cachedRead: vi.fn(),
			},
			fileManager: {
				generateMarkdownLink: vi.fn().mockReturnValue(""),
				processFrontMatter,
			},
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(null),
				getActiveViewOfType: vi.fn().mockReturnValue(null),
			},
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null),
			},
		} as unknown as App;

		const plugin = {
			settings: {
				enableTemplatePropertyTypes: true,
				globalVariables: {},
				showCaptureNotification: false,
				showInputCancellationNotification: false,
			},
		} as any;

		const choice: ICaptureChoice = {
			id: "capture",
			name: "Test Capture",
			type: "Capture",
			command: false,
			captureTo: targetPath,
			captureToActiveFile: false,
			createFileIfItDoesntExist: {
				enabled: true,
				createWithTemplate: false,
				template: "",
			},
			format: {
				enabled: true,
				format: ["---", "tags: {{VALUE:tags}}", "---", ""].join("\n"),
			},
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
		};

		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>([
				["tags", ["foo", "bar"]],
			]),
		};

		const engine = new CaptureChoiceEngine(app, plugin, choice, choiceExecutor);

		await engine.run();

		expect(writtenContent).toContain("tags: foo,bar");
		expect(processFrontMatter).toHaveBeenCalledTimes(1);
		expect(appliedFrontmatter?.tags).toEqual(["foo", "bar"]);
	});
});
