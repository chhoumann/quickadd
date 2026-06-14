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

	it("inserts before a matched target line", async () => {
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
			createChoice({
				insertBefore: {
					enabled: true,
					before: "## Later",
					createIfNotFound: false,
					createIfNotFoundLocation: "",
				},
			}),
			"# Inbox\nBody\n## Later\nNext",
			createFile(),
		);

		expect(result).toBe("# Inbox\nBody\nCAPTURE\n## Later\nNext");
	});

	it("separates capture content from the matched line when inserting before", async () => {
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
				insertBefore: {
					enabled: true,
					before: "Line B",
					createIfNotFound: false,
					createIfNotFoundLocation: "",
				},
			}),
			"Line A\nLine B",
			createFile(),
		);

		expect(result).toBe("Line A\nCAPTURE\nLine B");
	});

	it("resolves format syntax in insert-before target lines", async () => {
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
		formatter.setTitle("Project Alpha");

		const result = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertBefore: {
					enabled: true,
					before: "{{title}}",
					createIfNotFound: false,
					createIfNotFoundLocation: "",
				},
			}),
			"# Inbox\nProject Alpha\nBody",
			createFile("Project Alpha.md"),
		);

		expect(result).toBe("# Inbox\nCAPTURE\nProject Alpha\nBody");
	});

	it("creates a missing insert-before target below the capture", async () => {
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
				insertBefore: {
					enabled: true,
					before: "## Missing",
					createIfNotFound: true,
					createIfNotFoundLocation: "bottom",
				},
			}),
			"# Inbox",
			createFile(),
		);

		expect(result).toBe("# Inbox\nCAPTURE\n## Missing");
	});

	it("keeps existing body content separated when creating a missing insert-before target at top", async () => {
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
				insertBefore: {
					enabled: true,
					before: "## Missing",
					createIfNotFound: true,
					createIfNotFoundLocation: "top",
				},
			}),
			"Body",
			createFile(),
		);

		expect(result).toBe("CAPTURE\n## Missing\nBody");
	});

	it("keeps frontmatter body content separated when creating a missing insert-before target at top", async () => {
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
				insertBefore: {
					enabled: true,
					before: "## Missing",
					createIfNotFound: true,
					createIfNotFoundLocation: "top",
				},
			}),
			"---\ntitle: Test\n---\nBody",
			createFile(),
		);

		expect(result).toBe("---\ntitle: Test\n---\nCAPTURE\n## Missing\nBody");
	});

	it("captures a non-breaking-space-only payload instead of dropping it as empty (issue #760)", async () => {
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
			"\u00A0",
			createChoice({ captureToActiveFile: false, prepend: true }),
			"Line A\nLine B",
			createFile(),
		);

		expect(result).toBe("Line A\nLine B\n\u00A0");
	});

	it("returns a non-breaking-space-only payload from formatContentOnly (issue #760)", async () => {
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

		const result = await formatter.formatContentOnly("\u00A0");

		expect(result).toBe("\u00A0");
	});

	it("still treats ASCII-whitespace-only payloads as empty captures", async () => {
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
			" \t\n",
			createChoice({ captureToActiveFile: false, prepend: true }),
			"Line A\nLine B",
			createFile(),
		);

		expect(result).toBe("Line A\nLine B");
	});

	it("keeps task captures separated when creating a missing insert-before target at top", async () => {
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
			"- [ ] CAPTURE",
			createChoice({
				task: true,
				insertBefore: {
					enabled: true,
					before: "## Missing",
					createIfNotFound: true,
					createIfNotFoundLocation: "top",
				},
			}),
			"Body",
			createFile(),
		);

		expect(result).toBe("- [ ] CAPTURE\n## Missing\nBody");
	});

	it("inserts under the runtime-picked heading override instead of the static after text (#738)", async () => {
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

		// "Under heading…" sets a verbatim line override; the static `after` is ignored.
		formatter.setInsertAfterTargetOverride("## Foo");

		const result = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertAfter: {
					enabled: true,
					after: "## NeverUsed",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: false,
					createIfNotFoundLocation: "",
					inline: false,
					replaceExisting: false,
					blankLineAfterMatchMode: "auto",
					promptHeading: true,
				},
			}),
			"# Title\n## Foo\nexisting\n## Bar",
			createFile(),
		);

		expect(result).toBe("# Title\n## Foo\nCAPTURE\nexisting\n## Bar");
	});

	it("matches the heading override literally, never resolving token-like heading text (#738)", async () => {
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

		// A real heading whose text contains format-token syntax. If the override were run
		// through the format pipeline, "{{DATE}}" would resolve and desync from the real
		// line (target not found → throw, since createIfNotFound is false). Landing the
		// capture proves the override is matched verbatim.
		formatter.setInsertAfterTargetOverride("## {{DATE}}");

		const result = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertAfter: {
					enabled: true,
					after: "",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: false,
					createIfNotFoundLocation: "",
					inline: false,
					replaceExisting: false,
					blankLineAfterMatchMode: "auto",
					promptHeading: true,
				},
			}),
			"## {{DATE}}\nbody",
			createFile(),
		);

		expect(result).toBe("## {{DATE}}\nCAPTURE\nbody");
	});

	it("takes the block (section) path for a heading override even if a stale inline flag is set (#738 blocker)", async () => {
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

		formatter.setInsertAfterTargetOverride("## Foo");

		// inline:true is a stale flag from a prior "After line…" inline config. The override
		// must short-circuit the same-line inline path and insert on its own line under the
		// heading (belt-and-suspenders with the builder's onChange reset).
		const result = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertAfter: {
					enabled: true,
					after: "## NeverUsed",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: false,
					createIfNotFoundLocation: "",
					inline: true,
					replaceExisting: true,
					blankLineAfterMatchMode: "auto",
					promptHeading: true,
				},
			}),
			"## Foo\nexisting",
			createFile(),
		);

		expect(result).toBe("## Foo\nCAPTURE\nexisting");
	});

	it("creates a typed heading override via create-if-not-found, byte-symmetric with search (#738/#742)", async () => {
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

		// User typed a heading that doesn't exist yet; "Create line if not found" creates it.
		// The created block must be byte-identical to what the next run's search will match.
		formatter.setInsertAfterTargetOverride("## Tasks");

		const result = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertAfter: {
					enabled: true,
					after: "",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: true,
					createIfNotFoundLocation: "bottom",
					inline: false,
					replaceExisting: false,
					blankLineAfterMatchMode: "auto",
					promptHeading: true,
				},
			}),
			"# Title\nbody",
			createFile(),
		);

		expect(result).toBe("# Title\nbody\n## Tasks\nCAPTURE\n");
	});

	it("inserts under the FIRST occurrence when the note has duplicate heading text (#738)", async () => {
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

		// Two identical heading lines: the picker's items collapse to one and the search
		// resolves the first match (parity with the static "After line…" field). Locked so a
		// future override refactor can't silently change which section is targeted.
		formatter.setInsertAfterTargetOverride("## Tasks");

		const result = await formatter.formatContentWithFile(
			"CAPTURE\n",
			createChoice({
				insertAfter: {
					enabled: true,
					after: "",
					insertAtEnd: false,
					considerSubsections: false,
					createIfNotFound: false,
					createIfNotFoundLocation: "",
					inline: false,
					replaceExisting: false,
					blankLineAfterMatchMode: "auto",
					promptHeading: true,
				},
			}),
			"## Tasks\nfirst\n\n## Other\nx\n\n## Tasks\nsecond",
			createFile(),
		);

		expect(result).toBe(
			"## Tasks\nCAPTURE\nfirst\n\n## Other\nx\n\n## Tasks\nsecond",
		);
	});
});
