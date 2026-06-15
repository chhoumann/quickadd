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

const insertAfter = (after: string, insertAtEnd = false) => ({
	enabled: true,
	after,
	insertAtEnd,
	considerSubsections: false,
	createIfNotFound: false,
	createIfNotFoundLocation: "",
	inline: false,
	replaceExisting: false,
	blankLineAfterMatchMode: "auto" as const,
});

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
		format: { enabled: true, format: "{{VALUE}}" },
		prepend: false,
		appendLink: false,
		task: true,
		insertAfter: insertAfter("===== Task ======"),
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
 * Mirrors CaptureChoiceEngine.getCaptureContent(): "Format value as task" wraps
 * the format string and appends a trailing newline so a bare task is a complete
 * line. The blank-line bug (#312) lives in how that injected newline is joined,
 * so the test must feed the same task-shaped input the engine produces.
 */
const taskInput = (value: string) => `- [ ] ${value}\n`;

describe("issue #312 — no blank line after a task-formatted capture (insert after)", () => {
	it("does not add a blank line when the target has a blank line directly below it", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\n\nold one\n",
			createFile(),
		);

		expect(result).toBe("===== Task ======\n- [ ] buy milk\nold one\n");
		expect(result).not.toMatch(/- \[ \] buy milk\n\n/);
	});

	it("does not add a trailing blank when the target is followed only by a blank line at EOF", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\n\n",
			createFile(),
		);

		expect(result).toBe("===== Task ======\n- [ ] buy milk\n");
	});

	it("keeps the task on its own line (no glue) when content sits directly below the target", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\nold one\n",
			createFile(),
		);

		expect(result).toBe("===== Task ======\n- [ ] buy milk\nold one\n");
	});

	it("stacks repeated task captures tightly with no accumulating blank lines", async () => {
		let body = "===== Task ======\n\n";
		for (const value of ["A", "B", "C"]) {
			body = await createFormatter().formatContentWithFile(
				taskInput(value),
				createChoice(),
				body,
				createFile(),
			);
		}

		expect(body).toBe("===== Task ======\n- [ ] C\n- [ ] B\n- [ ] A\n");
		expect(body).not.toMatch(/\n[ \t]*\n/);
	});

	it("collapses the injected newline on the insert-at-end-of-section path too", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("new task"),
			createChoice({ insertAfter: insertAfter("## Task", true) }),
			"## Task\n- old\n\n## Other\nx\n",
			createFile(),
		);

		expect(result).toBe("## Task\n- old\n- [ ] new task\n## Other\nx\n");
		expect(result).not.toMatch(/- \[ \] new task\n\n/);
	});

	it("recognises a whitespace-only blank line directly below the target", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\n   \nold one\n",
			createFile(),
		);

		expect(result).not.toMatch(/- \[ \] buy milk\n[ \t]*\n/);
	});

	it("recognises a CRLF blank line directly below the target (#312 on Windows notes)", async () => {
		const result = await createFormatter().formatContentWithFile(
			taskInput("buy milk"),
			createChoice(),
			"===== Task ======\r\n\r\nold one\r\n",
			createFile(),
		);

		// No blank line after the task, and the CRLF following content is preserved.
		expect(result).toBe("===== Task ======\r\n- [ ] buy milk\r\nold one\r\n");
	});

	it("leaves a user-typed trailing newline in the format string untouched (gate is off for task: false)", async () => {
		// Guard/scope test: this passes with OR without the fix because the gate is
		// gated on choice.task. It pins the gate scope so a non-task capture whose
		// format intentionally ends in a newline keeps that explicit newline.
		const result = await createFormatter().formatContentWithFile(
			"buy milk\n",
			createChoice({ task: false }),
			"===== Task ======\n\nold one\n",
			createFile(),
		);

		expect(result).toBe("===== Task ======\nbuy milk\n\nold one\n");
	});
});
