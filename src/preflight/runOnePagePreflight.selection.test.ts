import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { runOnePagePreflight } from "./runOnePagePreflight";
import { UserCancelError } from "../errors/UserCancelError";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ITemplateChoice from "../types/choices/ITemplateChoice";

const { modalOpenMock } = vi.hoisted(() => ({
	modalOpenMock: vi.fn(),
}));

let modalResult: Record<string, string> = {};

vi.mock("./OnePageInputModal", () => ({
	OnePageInputModal: class {
		waitForClose = Promise.resolve(modalResult);
		constructor(...args: unknown[]) {
			modalOpenMock(...args);
		}
	},
}));

vi.mock("src/quickAddSettingsTab", () => ({
	QuickAddSettingsTab: class {},
}));

vi.mock("src/main", () => ({
	__esModule: true,
	default: class QuickAddMock {},
}));

vi.mock("obsidian-dataview", () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
}));

vi.mock("src/utilityObsidian", async () => {
	const { TFile } = await import("obsidian");
	return {
		getMarkdownFilesInFolder: vi.fn(() => []),
		getMarkdownFilesWithTag: vi.fn(() => []),
		getUserScript: vi.fn(),
		isFolder: vi.fn(() => false),
		// Faithful to the real resolver: trim, strip a leading slash, append .md
		// only when no template extension is present, then resolve to a TFile.
		getTemplateFile: vi.fn((app: App, path: string) => {
			const stripped = path.trim().replace(/^\/+/, "");
			if (!stripped) return null;
			const hasTemplateExt = /\.(md|canvas|base)$/i.test(stripped);
			const resolved = hasTemplateExt ? stripped : `${stripped}.md`;
			const f = app.vault.getAbstractFileByPath(resolved);
			return f instanceof TFile ? f : null;
		}),
	};
});

const createApp = (selection: string | null) =>
	({
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(
				selection === null
					? null
					: {
							editor: {
								getSelection: () => selection,
							},
						},
			),
		},
	} as unknown as App);

const createChoice = (): ICaptureChoice => ({
	id: "capture-choice-id",
	name: "Capture Choice",
	type: "Capture",
	command: false,
	captureTo: "Inbox.md",
	captureToActiveFile: true,
	createFileIfItDoesntExist: {
		enabled: false,
		createWithTemplate: false,
		template: "",
	},
	format: { enabled: true, format: "{{VALUE}}" },
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
		mode: "default",
		focus: true,
	},
});

const createExecutor = (): IChoiceExecutor => ({
	execute: vi.fn(),
	variables: new Map<string, unknown>(),
});

const createTemplateChoice = (templatePath: string): ITemplateChoice =>
	({
		id: "template-choice-id",
		name: "Template Choice",
		type: "Template",
		command: false,
		templatePath,
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		fileNameFormat: { enabled: false, format: "{{VALUE}}" },
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		fileExistsBehavior: { kind: "prompt" },
	}) as ITemplateChoice;

describe("runOnePagePreflight selection-as-value", () => {
	beforeEach(() => {
		modalOpenMock.mockClear();
		modalResult = {};
	});

	it("prefills {{VALUE}} from selection when enabled", async () => {
		const choice = createChoice();
		const executor = createExecutor();
		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: true,
			},
		} as any;

		const result = await runOnePagePreflight(
			createApp("Selected text"),
			plugin,
			executor,
			choice,
		);

		expect(result).toBe(false);
		expect(executor.variables.get("value")).toBe("Selected text");
		expect(modalOpenMock).not.toHaveBeenCalled();
	});

	it("treats a Markdown view without an editor like no selection (#1536)", async () => {
		const choice = createChoice();
		const executor = createExecutor();
		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: true,
			},
		} as any;
		// Thino-style Markdown-masquerading view: editor is null.
		const app = {
			workspace: {
				getActiveViewOfType: vi.fn().mockReturnValue({ editor: null }),
			},
		} as unknown as App;
		modalResult = { value: "Typed instead" };

		const result = await runOnePagePreflight(app, plugin, executor, choice);

		// The editor-less view yields no selection, so the modal collects
		// {{VALUE}} instead of the run crashing on editor.getSelection().
		expect(result).toBe(true);
		expect(modalOpenMock).toHaveBeenCalled();
		expect(executor.variables.get("value")).toBe("Typed instead");
	});

	it("collects via the promptProvider (not the Obsidian modal) for a remote run", async () => {
		const choice = createChoice();
		const executor = createExecutor();
		const requestInputs = vi.fn(async () => ({ value: "from raycast" }));
		(executor as IChoiceExecutor).promptProvider = {
			requestInputs,
		} as unknown as IChoiceExecutor["promptProvider"];
		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: false,
			},
		} as any;

		await runOnePagePreflight(createApp(null), plugin, executor, choice);

		expect(requestInputs).toHaveBeenCalledTimes(1);
		expect(modalOpenMock).not.toHaveBeenCalled();
		expect(executor.variables.get("value")).toBe("from raycast");
	});

	it("propagates a remote form cancellation instead of continuing", async () => {
		const choice = createChoice();
		const executor = createExecutor();
		const requestInputs = vi.fn(async () => {
			throw new UserCancelError("Input cancelled by user");
		});
		(executor as IChoiceExecutor).promptProvider = {
			requestInputs,
		} as unknown as IChoiceExecutor["promptProvider"];
		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: false,
			},
		} as any;

		await expect(
			runOnePagePreflight(createApp(null), plugin, executor, choice),
		).rejects.toBeInstanceOf(UserCancelError);
	});

	it("does not prefill when selection usage is disabled", async () => {
		const choice = createChoice();
		const executor = createExecutor();
		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: false,
			},
		} as any;
		modalResult = { value: "Manual" };

		const result = await runOnePagePreflight(
			createApp("Selected text"),
			plugin,
			executor,
			choice,
		);

		expect(result).toBe(true);
		expect(executor.variables.get("value")).toBe("Manual");
		expect(modalOpenMock).toHaveBeenCalledTimes(1);
	});
});

describe("runOnePagePreflight template extension handling", () => {
	beforeEach(() => {
		modalOpenMock.mockClear();
		modalResult = {};
	});

	it("reads .base template files without forcing .md", async () => {
		const templateFile = new TFile();
		templateFile.path = "Templates/Kanban.base";
		templateFile.name = "Kanban.base";
		templateFile.basename = "Kanban";
		templateFile.extension = "base";

		const app = {
			workspace: {
				getActiveViewOfType: vi.fn().mockReturnValue(null),
			},
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === "Templates/Kanban.base" ? templateFile : null,
				),
				cachedRead: vi.fn(async () => "{{VALUE:boardName}}"),
			},
		} as unknown as App;

		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: true,
			},
		} as any;

		const executor = createExecutor();
		modalResult = { boardName: "Project Board" };

		const result = await runOnePagePreflight(
			app,
			plugin,
			executor,
			createTemplateChoice("Templates/Kanban.base"),
		);

		expect(result).toBe(true);
		expect(modalOpenMock).toHaveBeenCalledTimes(1);
		expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(
			"Templates/Kanban.base",
		);
		expect(app.vault.getAbstractFileByPath).not.toHaveBeenCalledWith(
			"Templates/Kanban.base.md",
		);
	});

	it("leaves FIELD multi-select prompts for runtime instead of the one-page modal", async () => {
		const templateFile = new TFile();
		templateFile.path = "Templates/FieldMulti.md";
		templateFile.name = "FieldMulti.md";
		templateFile.basename = "FieldMulti";
		templateFile.extension = "md";

		const app = {
			workspace: {
				getActiveViewOfType: vi.fn().mockReturnValue(null),
			},
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === "Templates/FieldMulti.md" ? templateFile : null,
				),
				cachedRead: vi.fn(async () => "topics: {{FIELD:topic|multi}}"),
			},
		} as unknown as App;

		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: true,
			},
		} as any;

		const executor = createExecutor();

		const result = await runOnePagePreflight(
			app,
			plugin,
			executor,
			createTemplateChoice("Templates/FieldMulti.md"),
		);

		expect(result).toBe(false);
		expect(modalOpenMock).not.toHaveBeenCalled();
		expect(executor.variables.has("FIELD:topic|multi")).toBe(false);
	});

	it("leaves the default Template note title for discovery instead of the one-page modal", async () => {
		const templateFile = new TFile();
		templateFile.path = "Templates/Daily.md";
		templateFile.name = "Daily.md";
		templateFile.basename = "Daily";
		templateFile.extension = "md";

		const app = {
			workspace: {
				getActiveViewOfType: vi.fn().mockReturnValue(null),
			},
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === "Templates/Daily.md" ? templateFile : null,
				),
				cachedRead: vi.fn(async () => ""),
			},
		} as unknown as App;

		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: true,
			},
		} as any;

		const choice = createTemplateChoice("Templates/Daily.md");
		choice.discoverExistingNotesBeforeCreate = true;
		choice.fileNameFormat = { enabled: true, format: "{{VALUE}}" };

		const executor = createExecutor();

		const result = await runOnePagePreflight(app, plugin, executor, choice);

		expect(result).toBe(false);
		expect(modalOpenMock).not.toHaveBeenCalled();
		expect(executor.variables.has("value")).toBe(false);
	});

	it("still collects other Template prompts while leaving the note title for discovery", async () => {
		const templateFile = new TFile();
		templateFile.path = "Templates/Project.md";
		templateFile.name = "Project.md";
		templateFile.basename = "Project";
		templateFile.extension = "md";

		const app = {
			workspace: {
				getActiveViewOfType: vi.fn().mockReturnValue(null),
			},
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === "Templates/Project.md" ? templateFile : null,
				),
				cachedRead: vi.fn(async () => "Project: {{VALUE:project}}"),
			},
		} as unknown as App;

		const plugin = {
			settings: {
				inputPrompt: "single-line",
				globalVariables: {},
				useSelectionAsCaptureValue: true,
			},
		} as any;

		const choice = createTemplateChoice("Templates/Project.md");
		choice.discoverExistingNotesBeforeCreate = true;
		choice.fileNameFormat = { enabled: true, format: "{{VALUE}}" };

		const executor = createExecutor();
		modalResult = { project: "Atlas" };

		const result = await runOnePagePreflight(app, plugin, executor, choice);

		expect(result).toBe(true);
		expect(executor.variables.has("value")).toBe(false);
		expect(executor.variables.get("project")).toBe("Atlas");
		expect(modalOpenMock).toHaveBeenCalledTimes(1);
		const requirements = modalOpenMock.mock.calls[0][1] as Array<{ id: string }>;
		expect(requirements.map((requirement) => requirement.id)).toEqual([
			"project",
		]);
	});
});
