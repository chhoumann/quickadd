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
	isCancellationError: vi.fn().mockReturnValue(false),
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
	}) as ICaptureChoice;

const createMockApp = (selection: string | null): App =>
	({
		workspace: {
			getActiveFile: vi.fn().mockReturnValue(null),
			getActiveViewOfType: vi.fn().mockReturnValue(
				selection === null
					? null
					: { editor: { getSelection: () => selection } },
			),
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
	}) as unknown as App;

const createFile = (path = "Target.md"): TFile => {
	const name = path.split("/").pop() ?? path;
	return {
		path,
		name,
		basename: name.replace(/\.(md|canvas)$/i, ""),
		extension: "md",
	} as unknown as TFile;
};

const createFormatter = (selection: string | null) =>
	new CaptureChoiceFormatter(createMockApp(selection), {
		settings: {
			inputPrompt: "single-line",
			enableTemplatePropertyTypes: false,
			globalVariables: {},
			useSelectionAsCaptureValue: true,
		},
	} as any);

describe("capture linebreak escapes only apply to the format string (issue #527)", () => {
	beforeEach(() => {
		(global as any).navigator = {
			clipboard: {
				readText: vi.fn().mockResolvedValue(""),
			},
		};
	});

	it("preserves literal \\n in selected text through the two-pass capture flow", async () => {
		const formatter = createFormatter("\\nabla");

		// Pass 1: resolve {{VALUE}} (selection) — mirrors CaptureChoiceEngine.onFileExists
		const firstPass = await formatter.formatContentOnly("{{VALUE}}");
		expect(firstPass).toBe("\\nabla");

		// Pass 2: embed into the target file content
		const result = await formatter.formatContentWithFile(
			firstPass,
			createChoice(),
			"",
			createFile(),
		);
		expect(result).toBe("\\nabla");
	});

	it("preserves literal \\n in selected text on single-pass formatContentWithFile (canvas flow)", async () => {
		const formatter = createFormatter("\\nabla");

		const result = await formatter.formatContentWithFile(
			"{{VALUE}}",
			createChoice(),
			"existing",
			createFile(),
		);

		// Top insertion without frontmatter concatenates capture + body directly;
		// the point here is that the literal backslash-n survives untouched.
		expect(result).toBe("\\nablaexisting");
	});

	it("preserves backslash sequences in path-like selected text", async () => {
		const formatter = createFormatter("C:\\Users\\nadia");

		const firstPass = await formatter.formatContentOnly("{{VALUE}}");

		expect(firstPass).toBe("C:\\Users\\nadia");
	});

	it("still expands \\n typed in the capture format string", async () => {
		const formatter = createFormatter("hello");

		const firstPass = await formatter.formatContentOnly("- {{VALUE}}\\n");
		expect(firstPass).toBe("- hello\n");

		const result = await formatter.formatContentWithFile(
			firstPass,
			createChoice({ prepend: true }),
			"Line A",
			createFile(),
		);
		expect(result).toBe("Line A\n- hello\n");
	});

	it("keeps escaped \\\\n in the format string as literal \\n", async () => {
		const formatter = createFormatter("hello");

		const firstPass = await formatter.formatContentOnly("{{VALUE}} \\\\n");

		expect(firstPass).toBe("hello \\n");
	});
});
