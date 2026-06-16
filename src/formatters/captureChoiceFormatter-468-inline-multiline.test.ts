import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";

// Mocks mirror captureChoiceFormatter-742-multiline-insert.test.ts so the
// formatter can run under jsdom without real Obsidian/Templater. The inline
// single-line guard now throws ChoiceAbortError (asserted via rejects.toThrow),
// so these tests don't inspect reportError (issue #468).
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
	insertAtEnd: false,
	considerSubsections: false,
	createIfNotFound: false,
	createIfNotFoundLocation: "top",
	inline: true,
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

const run = (
	choice: ICaptureChoice,
	capture: string,
	fileContent: string,
): Promise<string> =>
	createFormatter().formatContentWithFile(
		capture,
		choice,
		fileContent,
		createFile(),
	);

/**
 * Inline insertion is single-line by definition. A `\n`-escape target renders as
 * a valid multi-line block in the settings preview, but inline can never match a
 * multi-line anchor. Before #468 the inline path skipped escape expansion, so it
 * searched for / wrote the LITERAL two-char `\n`: the match silently never
 * succeeded (createIfNotFound off) or a garbage line containing a literal
 * backslash-n was written (createIfNotFound on). The fix expands escapes so the
 * existing single-line guard fires and the capture aborts cleanly (a
 * ChoiceAbortError, like the block path's not-found abort) with nothing written.
 */
describe("#468 — inline insert-after with a multi-line target aborts cleanly, no silent miss / garbage write", () => {
	it("aborts with a clear 'single line' message when the block exists but inline is on", async () => {
		const choice = createChoice({
			insertAfter: { ...baseInsertAfter, after: "**Today**\\n***" },
		});
		// The block plainly exists; the non-inline block path matches it fine. Inline
		// must NOT silently miss with a misleading "target not found" — it must abort
		// with the real reason (multi-line target).
		const seed = "# Daily Notes\n\n**Today**\n***\n\nBelow.\n";
		await expect(run(choice, "CAPTURED", seed)).rejects.toThrow(/single line/i);
	});

	it("aborts (no literal-\\n garbage write) when createIfNotFound is on and the target is absent", async () => {
		const choice = createChoice({
			insertAfter: {
				...baseInsertAfter,
				after: "**Today**\\n***",
				createIfNotFound: true,
				createIfNotFoundLocation: "bottom",
			},
		});
		const seed = "# Notes\n\nNo anchor here.\n";
		// The single-line guard fires BEFORE the create path, so the literal
		// backslash-n block is never written — the run aborts instead.
		await expect(run(choice, "CAPTURED", seed)).rejects.toThrow(/single line/i);
	});

	it("control: a single-line inline target still inserts on the same line (no regression)", async () => {
		const choice = createChoice({
			insertAfter: { ...baseInsertAfter, after: "Status:" },
		});
		const result = await run(choice, " done", "Status: pending");

		expect(result).toBe("Status: done pending");
	});

	it("control: a multi-line target on the NON-inline block path still matches (issue #742 preserved)", async () => {
		const choice = createChoice({
			insertAfter: {
				...baseInsertAfter,
				after: "**Today**\\n***",
				inline: false,
			},
		});
		const seed = "# Daily Notes\n\n**Today**\n***\n\nBelow.\n";
		const result = await run(choice, "CAPTURED", seed);

		// Found and inserted after the block.
		expect(result).not.toBe(seed);
		expect(result).toContain("**Today**\n***");
		expect(result).toContain("CAPTURED");
	});

	// --- Boundary: escape semantics now shared with the block path (#742). ---
	// Expanding the inline target means `\n` is a newline QuickAdd-wide, while a
	// doubled backslash `\\` collapses to a single literal `\`. Pin both so a
	// future refactor can't silently widen/narrow the false-abort surface.

	it("control: an escaped backslash (\\\\) collapses to one literal backslash and still inserts (no false abort)", async () => {
		const choice = createChoice({
			// Stored value is the two chars `\` `\` then "X" — what a user types to
			// mean a literal backslash. It must NOT be read as a line break.
			insertAfter: { ...baseInsertAfter, after: "Path:\\\\X" },
		});
		const result = await run(choice, "-OK", "Path:\\X here");

		// `\\` -> `\`, so the single-line target "Path:\X" matches and inserts inline.
		expect(result).toBe("Path:\\X-OK here");
	});

	it("aborts a single-line-looking target that contains \\n (e.g. a Windows path 'C:\\notes') — \\n is a newline by convention", async () => {
		const choice = createChoice({
			// `C:\notes` — the `\n` is QuickAdd's newline escape, so this expands to a
			// multi-line target and is correctly rejected for inline (consistent with
			// the block path, which has expanded `\n` since #742).
			insertAfter: { ...baseInsertAfter, after: "C:\\notes" },
		});
		await expect(run(choice, "x", "C:\\notes\\file")).rejects.toThrow(
			/single line/i,
		);
	});

	it("aborts when a token expands to a multi-line value (guard runs AFTER expansion, not just escapes)", async () => {
		// A global variable whose snippet contains a real newline makes the resolved
		// inline target multi-line — the guard must catch it post-expansion.
		const formatter = new CaptureChoiceFormatter(createMockApp(), {
			settings: {
				inputPrompt: "single-line",
				enableTemplatePropertyTypes: false,
				globalVariables: { multi: "line-a\nline-b" },
				useSelectionAsCaptureValue: true,
			},
		} as any);
		const choice = createChoice({
			insertAfter: { ...baseInsertAfter, after: "{{GLOBAL_VAR:multi}}" },
		});

		await expect(
			formatter.formatContentWithFile(
				"x",
				choice,
				"line-a\nline-b\n",
				createFile(),
			),
		).rejects.toThrow(/single line/i);
	});
});
