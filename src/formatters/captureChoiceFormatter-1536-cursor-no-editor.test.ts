import { createSelectionFormatterPlugin } from "../../tests/helpers/formatters/plugin";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import { ChoiceAbortError } from "../errors/ChoiceAbortError";

// Mocks mirror captureChoiceFormatter-742-multiline-insert.test.ts so the
// formatter can run under jsdom without real Obsidian/Templater.
vi.mock("../utilityObsidian", async () => (await import("../../tests/helpers/formatters/mocks")).utilityObsidianMock());
vi.mock("../gui/InputPrompt", async () => (await import("../../tests/helpers/formatters/mocks")).InputPromptMock());
vi.mock("../gui/InputSuggester/inputSuggester", async () => (await import("../../tests/helpers/formatters/mocks")).inputSuggesterMock());
vi.mock("../gui/GenericSuggester/genericSuggester", async () => (await import("../../tests/helpers/formatters/mocks")).genericSuggesterMock());
vi.mock("../gui/VDateInputPrompt/VDateInputPrompt", async () => (await import("../../tests/helpers/formatters/mocks")).VDateInputPromptMock());
vi.mock("../utils/errorUtils", async () => (await import("../../tests/helpers/formatters/mocks")).errorUtilsMock());
vi.mock("../gui/MathModal", async () => (await import("../../tests/helpers/formatters/mocks")).MathModalMock());
vi.mock("../engine/SingleInlineScriptEngine", async () => (await import("../../tests/helpers/formatters/mocks")).SingleInlineScriptEngineMock());
vi.mock("../engine/SingleMacroEngine", async () => (await import("../../tests/helpers/formatters/mocks")).SingleMacroEngineMock());
vi.mock("../engine/SingleTemplateEngine", async () => (await import("../../tests/helpers/formatters/mocks")).SingleTemplateEngineMock());
vi.mock("obsidian-dataview", async () => (await import("../../tests/helpers/formatters/mocks")).obsidiandataviewMock());
vi.mock("../main", async () => (await import("../../tests/helpers/formatters/mocks")).mainMock());

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
	new CaptureChoiceFormatter(createMockApp(activeView), createSelectionFormatterPlugin());

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
