import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import InputSuggester from "src/gui/InputSuggester/inputSuggester";
import { CaptureChoiceEngine } from "./CaptureChoiceEngine";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { UserCancelError } from "../errors/UserCancelError";

// Capture the override the engine pushes into the formatter for the "Under heading…" path.
const { setInsertAfterTargetOverrideMock } = vi.hoisted(() => ({
	setInsertAfterTargetOverrideMock: vi.fn(),
}));

vi.mock("../formatters/captureChoiceFormatter", () => ({
	CaptureChoiceFormatter: class {
		setLinkToCurrentFileBehavior() {}
		setUseSelectionAsCaptureValue() {}
		setInsertAfterTargetOverride(target: string | null) {
			setInsertAfterTargetOverrideMock(target);
		}
		consumeCreatedClipboardAttachmentPaths() {
			return [];
		}
	},
}));

vi.mock("src/gui/InputSuggester/inputSuggester", () => ({
	default: class {},
}));

vi.mock("../utilityObsidian", () => ({
	appendToCurrentLine: vi.fn(() => true),
	getMarkdownFilesInFolder: vi.fn(() => []),
	getMarkdownFilesWithTag: vi.fn(() => []),
	insertFileLinkToActiveView: vi.fn(),
	insertOnNewLineAbove: vi.fn(() => true),
	insertOnNewLineBelow: vi.fn(() => true),
	isFolder: vi.fn(() => false),
	isTemplaterTriggerOnCreateEnabled: vi.fn(() => false),
	jumpToNextTemplaterCursorIfPossible: vi.fn(),
	openExistingFileTab: vi.fn(() => null),
	openFile: vi.fn(),
	overwriteTemplaterOnce: vi.fn(),
	templaterParseTemplate: vi.fn(async (_app: unknown, content: string) => content),
	waitForTemplaterTriggerOnCreateToComplete: vi.fn(),
}));

vi.mock("three-way-merge", () => ({ default: vi.fn(() => ({})), __esModule: true }));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
vi.mock("../main", () => ({ default: class QuickAddMock {} }));
vi.mock("./SingleTemplateEngine", () => ({
	SingleTemplateEngine: class {
		setLinkToCurrentFileBehavior() {}
		async run() {
			return "";
		}
		getAndClearTemplatePropertyVars() {
			return new Map();
		}
	},
}));

const HEADING_NOTE = "# Title\n\nintro\n\n## Tasks\n- a\n\n### Subtask\n- b\n\n## Notes\ntext";

const createApp = (content = HEADING_NOTE) =>
	({
		vault: {
			adapter: { exists: vi.fn(async () => true) },
			getAbstractFileByPath: vi.fn((path: string) =>
				Object.assign(new TFile(), {
					path,
					name: path,
					basename: path.replace(/\.md$/, ""),
					extension: "md",
				}),
			),
			read: vi.fn(async () => content),
			modify: vi.fn(async () => {}),
		},
		workspace: {
			getActiveFile: vi.fn(() => null),
			getActiveViewOfType: vi.fn(() => null),
		},
		fileManager: { getNewFileParent: vi.fn(() => ({ path: "" })) },
	}) as unknown as App;

const createChoice = (overrides: Partial<ICaptureChoice> = {}): ICaptureChoice => ({
	id: "capture-choice-id",
	name: "Capture Choice",
	type: "Capture",
	command: false,
	captureTo: "Inbox.md",
	captureToActiveFile: false,
	createFileIfItDoesntExist: { enabled: false, createWithTemplate: false, template: "" },
	format: { enabled: false, format: "" },
	prepend: false,
	appendLink: false,
	task: false,
	insertAfter: {
		enabled: true,
		after: "",
		insertAtEnd: false,
		considerSubsections: false,
		createIfNotFound: false,
		createIfNotFoundLocation: "top",
		inline: false,
		replaceExisting: false,
		blankLineAfterMatchMode: "auto",
		promptHeading: true,
	},
	newLineCapture: { enabled: false, direction: "below" },
	openFile: false,
	fileOpening: { location: "tab", direction: "vertical", mode: "default", focus: true },
	...overrides,
});

const createExecutor = (): IChoiceExecutor => ({
	execute: vi.fn(),
	variables: new Map<string, unknown>(),
});

const buildEngine = (choice: ICaptureChoice, app = createApp()) =>
	new CaptureChoiceEngine(
		app,
		{ settings: { useSelectionAsCaptureValue: false } } as any,
		choice,
		createExecutor(),
	);

describe("CaptureChoiceEngine 'Under heading…' runtime picker (#738)", () => {
	beforeEach(() => {
		setInsertAfterTargetOverrideMock.mockClear();
		delete (InputSuggester as any).Suggest;
	});

	it("offers byte-exact heading lines as items and indents the display by level", async () => {
		const suggestSpy = vi.fn(async () => "## Tasks");
		(InputSuggester as any).Suggest = suggestSpy;
		const engine = buildEngine(createChoice());

		await (engine as any).maybeResolveInsertAfterHeading(HEADING_NOTE);

		const [, displayItems, items] = suggestSpy.mock.calls[0] as unknown[];
		// items are the literal file lines (the insert-after search target).
		expect(items).toEqual(["# Title", "## Tasks", "### Subtask", "## Notes"]);
		// display is indented by heading level (level 1 → no indent).
		expect(displayItems).toEqual(["Title", "  Tasks", "    Subtask", "  Notes"]);
	});

	it("pushes the picked heading line to the formatter as a verbatim override", async () => {
		(InputSuggester as any).Suggest = vi.fn(async () => "## Tasks");
		const engine = buildEngine(createChoice());

		await (engine as any).maybeResolveInsertAfterHeading(HEADING_NOTE);

		expect(setInsertAfterTargetOverrideMock).toHaveBeenCalledWith("## Tasks");
		// Notice copy uses the heading TEXT (no '#').
		expect((engine as any).resolvedInsertAfterHeading).toBe("Tasks");
	});

	it("does nothing when promptHeading is off (plain 'After line…')", async () => {
		const suggestSpy = vi.fn(async () => "## Tasks");
		(InputSuggester as any).Suggest = suggestSpy;
		const engine = buildEngine(
			createChoice({
				insertAfter: {
					enabled: true,
					after: "## Tasks",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: false,
					createIfNotFoundLocation: "top",
					inline: false,
					replaceExisting: false,
					blankLineAfterMatchMode: "auto",
					promptHeading: false,
				},
			}),
		);

		await (engine as any).maybeResolveInsertAfterHeading(HEADING_NOTE);

		expect(suggestSpy).not.toHaveBeenCalled();
		expect(setInsertAfterTargetOverrideMock).not.toHaveBeenCalled();
	});

	it("resolves headings from arbitrary content (e.g. a Canvas text card body)", async () => {
		// The helper is content-based, so the same picker serves note bodies and canvas
		// text cards. handleCanvasTextCapture passes the card's text here.
		(InputSuggester as any).Suggest = vi.fn(async () => "## Card Heading");
		const engine = buildEngine(createChoice());

		await (engine as any).maybeResolveInsertAfterHeading(
			"# Card\n\n## Card Heading\n- note\n",
		);

		expect(setInsertAfterTargetOverrideMock).toHaveBeenCalledWith("## Card Heading");
		expect((engine as any).resolvedInsertAfterHeading).toBe("Card Heading");
	});

	it("lets the user type a heading when the content has no headings (custom value)", async () => {
		(InputSuggester as any).Suggest = vi.fn(async (_app, display, items) => {
			expect(display).toEqual([]);
			expect(items).toEqual([]);
			return "## New Heading";
		});
		const engine = buildEngine(createChoice());

		await (engine as any).maybeResolveInsertAfterHeading("just body text\nmore");

		expect(setInsertAfterTargetOverrideMock).toHaveBeenCalledWith("## New Heading");
		// Custom value isn't a known heading line → notice falls back to the raw value.
		expect((engine as any).resolvedInsertAfterHeading).toBe("## New Heading");
	});

	it("aborts cleanly (UserCancelError) when the picker is dismissed", async () => {
		(InputSuggester as any).Suggest = vi.fn(async () => {
			throw "no input given.";
		});
		const engine = buildEngine(createChoice());

		await expect(
			(engine as any).maybeResolveInsertAfterHeading(HEADING_NOTE),
		).rejects.toBeInstanceOf(UserCancelError);
		expect(setInsertAfterTargetOverrideMock).not.toHaveBeenCalled();
	});
});
