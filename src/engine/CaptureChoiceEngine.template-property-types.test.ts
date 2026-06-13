import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile, TFolder } from "obsidian";
import { TFile as ObsidianTFile, TFolder as ObsidianTFolder } from "obsidian";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import { insertOnNewLineBelow } from "../utilityObsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";

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
		openExistingFileTab: vi.fn().mockReturnValue(null),
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

	it("writes a YAML-safe placeholder before post-processing capture frontmatter arrays", async () => {
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

		// The raw file write only needs to stay YAML-parseable; processFrontMatter
		// applies the final structured array value afterward.
		expect(writtenContent).toContain("tags: []");
		expect(processFrontMatter).toHaveBeenCalledTimes(1);
		expect(appliedFrontmatter?.tags).toEqual(["foo", "bar"]);
	});

	it("aborts missing insert-after target without modifying file or applying property vars", async () => {
		const targetPath = "Journal/Test.md";
		const existingFile = {
			path: targetPath,
			name: "Test.md",
			basename: "Test",
			extension: "md",
		} as unknown as TFile;
		const modify = vi.fn(async () => {});

		const app = {
			vault: {
				adapter: {
					exists: vi.fn(async (path: string) => path === targetPath),
				},
				getAbstractFileByPath: vi.fn((path: string) =>
					path === targetPath ? existingFile : null,
				),
				read: vi.fn(async () => ["# Existing", "Body"].join("\n")),
				modify,
				cachedRead: vi.fn(),
			},
			fileManager: {
				generateMarkdownLink: vi.fn().mockReturnValue(""),
				processFrontMatter: vi.fn(),
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
				showCaptureNotification: true,
				showInputCancellationNotification: false,
			},
		} as any;

		const choice: ICaptureChoice = {
			id: "capture-insert-after-abort",
			name: "Insert After Abort",
			type: "Capture",
			command: false,
			captureTo: targetPath,
			captureToActiveFile: false,
			createFileIfItDoesntExist: {
				enabled: false,
				createWithTemplate: false,
				template: "",
			},
			format: {
				enabled: true,
				format: "Captured",
			},
			prepend: false,
			appendLink: false,
			task: false,
			insertAfter: {
				enabled: true,
				after: "# Missing",
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
			variables: new Map<string, unknown>(),
		};

		const engine = new CaptureChoiceEngine(app, plugin, choice, choiceExecutor);
		const applyCapturePropertyVars = vi.fn(async () => {});
		(engine as any).applyCapturePropertyVars = applyCapturePropertyVars;

		await engine.run();

		expect(modify).not.toHaveBeenCalled();
		expect(applyCapturePropertyVars).not.toHaveBeenCalled();
	});

	it("editor-insertion (newLineBelow) inlines container values as text instead of stranding a placeholder", async () => {
		// Regression: editor-insertion writes to the body, where front matter
		// property types are meaningless. Collection must be suppressed so a
		// collected array is NOT left as a "[]" placeholder with no apply step.
		const activeFilePath = "Daily/Today.md";
		const tFile = {
			path: activeFilePath,
			name: "Today.md",
			basename: "Today",
			extension: "md",
		} as unknown as TFile;
		if (typeof ObsidianTFile === "function") {
			Object.setPrototypeOf(tFile as unknown as object, ObsidianTFile.prototype);
		}

		const processFrontMatter = vi.fn();
		const app = {
			vault: {
				adapter: { exists: vi.fn(async (p: string) => p === activeFilePath) },
				getAbstractFileByPath: vi.fn((p: string) => (p === activeFilePath ? tFile : null)),
				create: vi.fn(),
				read: vi.fn(async () => "existing body\n"),
				cachedRead: vi.fn(async () => "existing body\n"),
				modify: vi.fn(),
			},
			fileManager: {
				generateMarkdownLink: vi.fn().mockReturnValue(""),
				processFrontMatter,
			},
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(tFile),
				getActiveViewOfType: vi.fn().mockReturnValue(null),
				activeLeaf: null,
				getMostRecentLeaf: vi.fn().mockReturnValue(null),
			},
			metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
		} as unknown as App;

		const plugin = {
			settings: {
				enableTemplatePropertyTypes: true, // even with the toggle ON, body insertion must not collect
				globalVariables: {},
				showCaptureNotification: false,
				showInputCancellationNotification: false,
			},
		} as any;

		const choice = {
			id: "capture",
			name: "Insertion Capture",
			type: "Capture",
			command: false,
			captureTo: "",
			captureToActiveFile: true,
			newLineCapture: { enabled: true, direction: "below" },
			createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
			format: { enabled: true, format: ["---", "cast: {{VALUE:cast}}", "---", ""].join("\n") },
			prepend: false,
			appendLink: false,
			task: false,
			insertAfter: {
				enabled: false, after: "", insertAtEnd: false, considerSubsections: false,
				createIfNotFound: false, createIfNotFoundLocation: "",
			},
			openFile: false,
			fileOpening: { location: "tab", direction: "vertical", mode: "source", focus: false },
		} as unknown as ICaptureChoice;

		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>([["cast", ["[[A]]", "[[B]]"]]]),
		};

		const engine = new CaptureChoiceEngine(app, plugin, choice, choiceExecutor);
		await engine.run();

		// The array is inlined as text (no data loss), not collected -> no placeholder, no processFrontMatter.
		expect(insertOnNewLineBelow).toHaveBeenCalledTimes(1);
		const inserted = (insertOnNewLineBelow as any).mock.calls[0][0] as string;
		expect(inserted).toContain("cast: [[A]],[[B]]");
		expect(inserted).not.toContain("cast: []");
		expect(processFrontMatter).not.toHaveBeenCalled();
	});

	it("append into an EXISTING file inlines a frontmatter-shaped capture in the body, never collecting it", async () => {
		// Regression for the reviewer finding: a frontmatter-shaped capture appended
		// to an existing file lands in the BODY. It must NOT be collected (which would
		// leave a "[]" placeholder in the body AND write the value to the wrong note's
		// real front matter).
		const targetPath = "Notes/Existing.md";
		const existing = "---\ntitle: Keep\n---\nbody line\n";
		let written = "";

		const tFile = {
			path: targetPath, name: "Existing.md", basename: "Existing", extension: "md",
		} as unknown as TFile;
		if (typeof ObsidianTFile === "function") {
			Object.setPrototypeOf(tFile as unknown as object, ObsidianTFile.prototype);
		}

		const processFrontMatter = vi.fn();
		const app = {
			vault: {
				adapter: { exists: vi.fn(async (p: string) => p === targetPath) },
				getAbstractFileByPath: vi.fn((p: string) => (p === targetPath ? tFile : null)),
				create: vi.fn(),
				read: vi.fn(async () => existing),
				cachedRead: vi.fn(async () => existing),
				modify: vi.fn(async (_f: TFile, content: string) => { written = content; }),
			},
			fileManager: { generateMarkdownLink: vi.fn().mockReturnValue(""), processFrontMatter },
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(null),
				getActiveViewOfType: vi.fn().mockReturnValue(null),
				activeLeaf: null,
				getMostRecentLeaf: vi.fn().mockReturnValue(null),
			},
			metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
		} as unknown as App;

		const plugin = {
			settings: {
				enableTemplatePropertyTypes: true,
				globalVariables: {},
				showCaptureNotification: false,
				showInputCancellationNotification: false,
			},
		} as any;

		const choice = {
			id: "capture", name: "Append Capture", type: "Capture", command: false,
			captureTo: targetPath, captureToActiveFile: false,
			createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
			format: { enabled: true, format: ["---", "cast: {{VALUE:cast}}", "---", ""].join("\n") },
			prepend: false, appendLink: false, task: false,
			insertAfter: {
				enabled: false, after: "", insertAtEnd: false, considerSubsections: false,
				createIfNotFound: false, createIfNotFoundLocation: "",
			},
			openFile: false,
			fileOpening: { location: "tab", direction: "vertical", mode: "source", focus: false },
			useSelectionAsCaptureValue: false,
		} as unknown as ICaptureChoice;

		const choiceExecutor: IChoiceExecutor = {
			execute: vi.fn(),
			variables: new Map<string, unknown>([["cast", ["[[A]]", "[[B]]"]]]),
		};

		const engine = new CaptureChoiceEngine(app, plugin, choice, choiceExecutor);
		await engine.run();

		expect(written).toContain("cast: [[A]],[[B]]"); // inlined in the body
		expect(written).not.toContain("cast: []"); // not a stranded placeholder
		expect(written).toContain("title: Keep"); // existing front matter untouched
		expect(processFrontMatter).not.toHaveBeenCalled(); // no misplaced front matter write
	});
});
