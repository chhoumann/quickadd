import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";

// Mocks mirror captureChoiceFormatter-742-multiline-insert.test.ts so the
// formatter can run under jsdom without real Obsidian/Templater.
vi.mock("../utilityObsidian", () => ({
	templaterParseTemplate: vi.fn().mockResolvedValue(null),
}));
vi.mock("../gui/InputPrompt", () => ({
	__esModule: true,
	default: class {
		factory() {
			return {
				Prompt: vi.fn().mockResolvedValue(""),
				PromptWithContext: vi.fn().mockResolvedValue(""),
			} as any;
		}
	},
}));
vi.mock("../gui/InputSuggester/inputSuggester", () => ({
	__esModule: true,
	default: class {
		constructor() {}
	},
}));
vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	__esModule: true,
	default: { Suggest: vi.fn().mockResolvedValue("") },
}));
vi.mock("../gui/VDateInputPrompt/VDateInputPrompt", () => ({
	__esModule: true,
	default: { Prompt: vi.fn().mockResolvedValue("") },
}));
vi.mock("../utils/errorUtils", () => ({
	__esModule: true,
	reportError: vi.fn(),
	isCancellationError: vi.fn().mockReturnValue(false),
}));
vi.mock("../gui/MathModal", () => ({
	__esModule: true,
	MathModal: { Prompt: vi.fn().mockResolvedValue("") },
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
vi.mock("../engine/SingleTemplateEngine", () => ({
	__esModule: true,
	SingleTemplateEngine: class {
		async run() {
			return "";
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
		setLinkToCurrentFileBehavior() {}
	},
}));
vi.mock("obsidian-dataview", () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
}));
vi.mock("../main", () => ({
	__esModule: true,
	default: class QuickAdd {
		static instance = {
			settings: { inputPrompt: "single-line" },
			app: {
				workspace: { getActiveViewOfType: vi.fn().mockReturnValue(null) },
			},
		};
		settings = QuickAdd.instance.settings;
		app = QuickAdd.instance.app;
	},
}));

import { CaptureChoiceFormatter } from "./captureChoiceFormatter";

const createChoice = (
	overrides: Partial<ICaptureChoice> = {},
): ICaptureChoice =>
	({
		id: "test",
		name: "Test Choice",
		type: "Capture",
		command: false,
		captureTo: "Target.md",
		captureToActiveFile: false,
		captureToCanvasNodeId: "",
		activeFileWritePosition: "cursor",
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
			enabled: true,
			after: "## Log",
			insertAtEnd: false,
			considerSubsections: false,
			createIfNotFound: true,
			createIfNotFoundLocation: "cursor",
			inline: false,
			replaceExisting: false,
			blankLineAfterMatchMode: "auto" as const,
		},
		insertBefore: {
			enabled: false,
			before: "",
			createIfNotFound: false,
			createIfNotFoundLocation: "top",
		},
		newLineCapture: { enabled: false, direction: "below" },
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		...overrides,
	}) as ICaptureChoice;

const createMockApp = (activeView: unknown): App =>
	({
		workspace: {
			getActiveFile: vi.fn().mockReturnValue(null),
			getActiveViewOfType: vi.fn().mockReturnValue(activeView),
		},
		metadataCache: { getFileCache: vi.fn().mockReturnValue(null) },
		fileManager: {
			generateMarkdownLink: vi.fn().mockReturnValue(""),
			processFrontMatter: vi.fn(),
		},
		vault: { adapter: { exists: vi.fn() }, cachedRead: vi.fn() },
	}) as unknown as App;

const createFile = (path = "Target.md"): TFile =>
	({
		path,
		name: path,
		basename: path.replace(/\.md$/i, ""),
		extension: "md",
	}) as unknown as TFile;

const createFormatter = (activeView: unknown) =>
	new CaptureChoiceFormatter(createMockApp(activeView), {
		settings: {
			inputPrompt: "single-line",
			enableTemplatePropertyTypes: false,
			globalVariables: {},
			useSelectionAsCaptureValue: true,
		},
	} as any);

beforeEach(() => {
	(global as any).navigator = {
		clipboard: { readText: vi.fn().mockResolvedValue("") },
	};
});

describe("#1536 — create-if-not-found at cursor without an active editor", () => {
	const SEED = "# Daily Notes\n";

	it("aborts with the missing-editor diagnostic when no markdown view is active", async () => {
		const formatter = createFormatter(null);
		await expect(
			formatter.formatContentWithFile("- task\n", createChoice(), SEED, createFile()),
		).rejects.toThrow(
			new ChoiceAbortError(
				"Unable to insert line '## Log' at cursor position: no active markdown editor.",
			),
		);
	});

	it("aborts with the missing-editor diagnostic for a Markdown-masquerading view with editor: null", async () => {
		// Thino patches getActiveViewOfType to return such a view.
		const formatter = createFormatter({ editor: null });
		await expect(
			formatter.formatContentWithFile("- task\n", createChoice(), SEED, createFile()),
		).rejects.toThrow("no active markdown editor");
	});

	it("inserts at the cursor line when a real editor is active (control)", async () => {
		const formatter = createFormatter({
			editor: { getCursor: () => ({ line: 0, ch: 0 }) },
		});
		const result = await formatter.formatContentWithFile(
			"- task\n",
			createChoice(),
			SEED,
			createFile(),
		);
		expect(result).toContain("## Log");
		expect(result).toContain("- task");
	});
});
