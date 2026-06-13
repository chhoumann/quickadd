import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";

// Mocks mirror captureChoiceFormatter-linebreak.test.ts so the formatter can run
// under jsdom without real Obsidian/Templater.
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

const baseInsertAfter = {
	enabled: true,
	after: "",
	insertAtEnd: true,
	considerSubsections: false,
	createIfNotFound: true,
	createIfNotFoundLocation: "bottom",
	inline: false,
	replaceExisting: false,
	blankLineAfterMatchMode: "auto" as const,
};

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
		insertAfter: { ...baseInsertAfter },
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

const createMockApp = (): App =>
	({
		workspace: {
			getActiveFile: vi.fn().mockReturnValue(null),
			getActiveViewOfType: vi.fn().mockReturnValue(null),
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
		name: path.split("/").pop() ?? path,
		basename: (path.split("/").pop() ?? path).replace(/\.(md|canvas)$/i, ""),
		extension: "md",
	}) as unknown as TFile;

const createFormatter = () =>
	new CaptureChoiceFormatter(createMockApp(), {
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

/**
 * Runs the capture insert flow `n` times, feeding each run's output back as the
 * next run's file content — exactly how repeated captures behave in Obsidian.
 * A fresh formatter per run mirrors CaptureChoiceEngine (one formatter/capture).
 */
async function runCaptures(
	choice: ICaptureChoice,
	seed: string,
	n: number,
	capture = "- task\n",
): Promise<string> {
	let content = seed;
	for (let i = 0; i < n; i++) {
		const formatter = createFormatter();
		content = await formatter.formatContentWithFile(
			capture,
			choice,
			content,
			createFile(),
		);
	}
	return content;
}

const count = (haystack: string, needle: string) =>
	haystack.split(needle).length - 1;

describe("#742 — multi-line insert-after target + createIfNotFound must not duplicate the block", () => {
	const SEED = "# Daily Notes\n";

	it("does NOT duplicate a mid-newline multi-line block across runs", async () => {
		const choice = createChoice({
			insertAfter: { ...baseInsertAfter, after: "**Today**\\n***" },
		});
		const result = await runCaptures(choice, SEED, 3);
		expect(count(result, "**Today**")).toBe(1);
		expect(count(result, "***")).toBe(1);
		expect(count(result, "- task")).toBe(3);
	});

	it("does NOT duplicate a double-newline block across runs", async () => {
		const choice = createChoice({
			insertAfter: { ...baseInsertAfter, after: "**Today**\\n\\n" },
		});
		const result = await runCaptures(choice, SEED, 3);
		expect(count(result, "**Today**")).toBe(1);
		expect(count(result, "- task")).toBe(3);
	});

	it("preserves single-trailing-newline behavior (control): 1 block", async () => {
		const choice = createChoice({
			insertAfter: { ...baseInsertAfter, after: "**Today**\\n" },
		});
		const result = await runCaptures(choice, SEED, 3);
		expect(count(result, "**Today**")).toBe(1);
		expect(count(result, "- task")).toBe(3);
	});

	it("preserves single-line behavior (control): 1 block", async () => {
		const choice = createChoice({
			insertAfter: { ...baseInsertAfter, after: "**Today**" },
		});
		const result = await runCaptures(choice, SEED, 3);
		expect(count(result, "**Today**")).toBe(1);
		expect(count(result, "- task")).toBe(3);
	});

	it("matches a heading-led multi-line block with an interior blank and keeps the blank", async () => {
		const choice = createChoice({
			insertAfter: { ...baseInsertAfter, after: "## D\\n\\n**Tasks**" },
		});
		const result = await runCaptures(choice, SEED, 3);
		expect(count(result, "## D")).toBe(1);
		expect(count(result, "**Tasks**")).toBe(1);
		// Interior blank between heading and **Tasks** is required for the match
		// and must survive every run.
		expect(result).toContain("## D\n\n**Tasks**");
		expect(count(result, "- task")).toBe(3);
	});

	it("immediate-insert (insertAtEnd=false) finds the block and does not split it", async () => {
		const choice = createChoice({
			insertAfter: {
				...baseInsertAfter,
				after: "**Today**\\n***",
				insertAtEnd: false,
			},
		});
		const result = await runCaptures(choice, SEED, 3);
		expect(count(result, "**Today**")).toBe(1);
		// Block stays contiguous (heading line immediately followed by ***).
		expect(result).toContain("**Today**\n***");
		expect(count(result, "- task")).toBe(3);
	});

	it("does not false-match flat content for an indented multi-line target, and round-trips", async () => {
		const choice = createChoice({
			insertAfter: {
				...baseInsertAfter,
				after: "  - Parent\\n    - Child",
				insertAtEnd: false,
			},
		});
		// Pre-existing FLAT list that must NOT be treated as the indented anchor.
		const seed = "# Notes\n- Parent\n- Child\n";
		const result = await runCaptures(choice, seed, 2);
		// The indented anchor is created (leading indentation is significant)...
		expect(result).toContain("  - Parent\n    - Child");
		// ...and found on run 2 (round-trip), so the 4-space child appears once.
		expect(count(result, "    - Child")).toBe(1);
		// The original flat block is left untouched.
		expect(result).toContain("# Notes\n- Parent\n- Child");
		expect(count(result, "- task")).toBe(2);
	});

	it("does not throw on considerSubsections + insertAtEnd with a non-heading multi-line anchor", async () => {
		const choice = createChoice({
			insertAfter: {
				...baseInsertAfter,
				after: "**Today**\\n***",
				insertAtEnd: true,
				considerSubsections: true,
			},
		});
		// considerSubsections only applies to headings; a non-heading anchor must
		// degrade gracefully instead of throwing in getEndOfSection (issue #742).
		const result = await runCaptures(choice, SEED, 3);
		expect(count(result, "**Today**")).toBe(1);
		expect(count(result, "- task")).toBe(3);
	});

	it("still honors considerSubsections for a heading-led multi-line anchor", async () => {
		const choice = createChoice({
			insertAfter: {
				...baseInsertAfter,
				after: "## D\\n**Tasks**",
				insertAtEnd: true,
				considerSubsections: true,
			},
		});
		const result = await runCaptures(choice, SEED, 3);
		expect(count(result, "## D")).toBe(1);
		expect(count(result, "**Tasks**")).toBe(1);
		expect(count(result, "- task")).toBe(3);
	});

	it("matches a CRLF file (trailing carriage returns are normalized)", async () => {
		const choice = createChoice({
			insertAfter: { ...baseInsertAfter, after: "**Today**\\n***" },
		});
		// Pre-create the block with CRLF line endings; the LF target must still find it.
		const seed = "# Daily Notes\r\n\r\n**Today**\r\n***\r\n";
		const result = await runCaptures(choice, seed, 2);
		expect(count(result, "**Today**")).toBe(1);
		expect(count(result, "- task")).toBe(2);
	});

	it("aborts on an empty target instead of silently anchoring the top of the file", async () => {
		const choice = createChoice({
			insertAfter: { ...baseInsertAfter, after: "" },
		});
		const formatter = createFormatter();
		await expect(
			formatter.formatContentWithFile("- task\n", choice, SEED, createFile()),
		).rejects.toThrow();
	});
});

describe("#742 — insert-before multi-line target + createIfNotFound", () => {
	const SEED = "# Daily Notes\n";

	it("anchors at the block start and does not duplicate or split across runs", async () => {
		const choice = createChoice({
			insertAfter: { ...baseInsertAfter, enabled: false },
			insertBefore: {
				enabled: true,
				before: "**Today**\\n***",
				createIfNotFound: true,
				createIfNotFoundLocation: "bottom",
			},
		});
		const result = await runCaptures(choice, SEED, 3);
		expect(count(result, "**Today**")).toBe(1);
		// The anchor block stays contiguous — capture lands before it, not inside.
		expect(result).toContain("**Today**\n***");
		expect(count(result, "- task")).toBe(3);
	});
});
