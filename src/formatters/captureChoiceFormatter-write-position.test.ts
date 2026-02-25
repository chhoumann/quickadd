import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";

vi.mock("../utilityObsidian", () => ({
	templaterParseTemplate: vi.fn().mockResolvedValue(null),
}));

vi.mock("../gui/InputPrompt", () => ({
	__esModule: true,
	default: class {
		factory() {
			return {
				Prompt: vi.fn().mockResolvedValue(""),
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
	default: {
		Suggest: vi.fn().mockResolvedValue(""),
	},
}));

vi.mock("../gui/VDateInputPrompt/VDateInputPrompt", () => ({
	__esModule: true,
	default: {
		Prompt: vi.fn().mockResolvedValue(""),
	},
}));

vi.mock("../utils/errorUtils", () => ({
	__esModule: true,
	reportError: vi.fn(),
}));

vi.mock("../gui/MathModal", () => ({
	__esModule: true,
	MathModal: {
		Prompt: vi.fn().mockResolvedValue(""),
	},
}));

vi.mock("../engine/SingleInlineScriptEngine", () => ({
	__esModule: true,
	SingleInlineScriptEngine: class {
		public params = { variables: {} as Record<string, unknown> };
		constructor() {}
		async runAndGetOutput() {
			return "";
		}
	},
}));

vi.mock("../engine/SingleMacroEngine", () => ({
	__esModule: true,
	SingleMacroEngine: class {
		constructor() {}
		async runAndGetOutput() {
			return "";
		}
	},
}));

vi.mock("../engine/SingleTemplateEngine", () => ({
	__esModule: true,
	SingleTemplateEngine: class {
		constructor() {}
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

const createChoice = (overrides: Partial<ICaptureChoice> = {}): ICaptureChoice => ({
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
		enabled: false,
		after: "",
		insertAtEnd: false,
		considerSubsections: false,
		createIfNotFound: false,
		createIfNotFoundLocation: "",
		inline: false,
		replaceExisting: false,
		blankLineAfterMatchMode: "auto",
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
});

const createMockApp = (): App =>
	({
		workspace: {
			getActiveFile: vi.fn().mockReturnValue(null),
			getActiveViewOfType: vi.fn().mockReturnValue(null),
		},
		metadataCache: {
			getFileCache: vi.fn().mockReturnValue(null),
		},
		fileManager: {
			generateMarkdownLink: vi.fn().mockReturnValue(""),
			processFrontMatter: vi.fn(),
		},
		vault: {
			adapter: { exists: vi.fn() },
			cachedRead: vi.fn(),
		},
	} as unknown as App);

const createFile = (path = "Test.md"): TFile => {
	const name = path.split("/").pop() ?? path;
	return {
		path,
		name,
		basename: name.replace(/\.(md|canvas)$/i, ""),
		extension: "md",
	} as unknown as TFile;
};

describe("CaptureChoiceFormatter write position behavior", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		(global as any).navigator = {
			clipboard: {
				readText: vi.fn().mockResolvedValue(""),
			},
		};
	});

	it("writes to top for non-active targets when prepend is false", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			{
				settings: {
					enableTemplatePropertyTypes: false,
					globalVariables: {},
					showCaptureNotification: false,
					showInputCancellationNotification: true,
				},
			} as any,
		);

		const result = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({ captureToActiveFile: false, prepend: false }),
			"Line A\nLine B",
			createFile(),
		);

		expect(result).toBe("CAPTURE\nLine A\nLine B");
	});

	it("writes to bottom for non-active targets when prepend is true", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			{
				settings: {
					enableTemplatePropertyTypes: false,
					globalVariables: {},
					showCaptureNotification: false,
					showInputCancellationNotification: true,
				},
			} as any,
		);

		const result = await formatter.formatContentWithFile(
			"CAPTURE",
			createChoice({ captureToActiveFile: false, prepend: true }),
			"Line A\nLine B",
			createFile(),
		);

		expect(result).toBe("Line A\nLine B\nCAPTURE");
	});

	it("writes to bottom for active-file targets when mode is bottom", async () => {
		const formatter = new CaptureChoiceFormatter(
			createMockApp(),
			{
				settings: {
					enableTemplatePropertyTypes: false,
					globalVariables: {},
					showCaptureNotification: false,
					showInputCancellationNotification: true,
				},
			} as any,
		);

		const result = await formatter.formatContentWithFile(
			"CAPTURE",
			createChoice({
				captureToActiveFile: true,
				activeFileWritePosition: "bottom",
				prepend: false,
			}),
			"Line A\nLine B",
			createFile("Active.md"),
		);

		expect(result).toBe("Line A\nLine B\nCAPTURE");
	});
});
