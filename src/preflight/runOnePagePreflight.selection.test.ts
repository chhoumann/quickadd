import { createPreflightPlugin } from "../../tests/helpers/preflight/choices";
import { createCaptureChoice, createTemplateChoice as templateChoiceFixture } from "../../tests/helpers/preflight/choices";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import {
	orderOnePageFilePicks,
	runOnePagePreflight,
} from "./runOnePagePreflight";
import { UserCancelError } from "../errors/UserCancelError";
import type ICaptureChoice from "../types/choices/ICaptureChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import { parseFileToken } from "src/utils/fileSyntax";
import type { TemplateNoteSelection } from "src/utils/templateNoteDiscovery";
import { getPreparedTemplateNoteSelection, withPreparedChoiceInputs } from "./preparedChoiceInputs";
import { loadUserScript } from "src/utils/userScript";
import { CommandType } from "src/types/macros/CommandType";
import type IMacroChoice from "src/types/choices/IMacroChoice";
import type { IUserScript } from "src/types/macros/IUserScript";

const { modalOpenMock } = vi.hoisted(() => ({
	modalOpenMock: vi.fn(),
}));

let modalResult: Record<string, string> = {};
let modalFileSelections = new Map<string, string[]>();
let modalMultiSelections = new Map<string, string[]>();
let modalFieldLinkSelections = new Map<string, string[]>();
let modalDiscoverySelections = new Map<string, TemplateNoteSelection>();

vi.mock("./OnePageInputModal", () => ({
	OnePageInputModal: class {
		waitForClose = Promise.resolve(modalResult);
		fileSelections = modalFileSelections;
		multiSelections = modalMultiSelections;
		fieldLinkSelections = modalFieldLinkSelections;
		discoverySelections = modalDiscoverySelections;
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

vi.mock("src/utils/vaultQueries", async (importOriginal) => ({
	...(await importOriginal<object>()),
	getMarkdownFilesInFolder: vi.fn(() => []),
	getMarkdownFilesWithTag: vi.fn(() => []),
	isFolder: vi.fn(() => false),
}));
vi.mock("src/utils/userScript", async (importOriginal) => ({
	...(await importOriginal<object>()),
	loadUserScript: vi.fn(),
}));
vi.mock("src/utils/templateFolderUtils", async () => {
	const { TFile } = await import("obsidian");
	return {
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
	...createCaptureChoice("Inbox.md"),
	id: "capture-choice-id",
	name: "Capture Choice",
	captureToActiveFile: true,
	format: { enabled: true, format: "{{VALUE}}" },
});

const createExecutor = (): IChoiceExecutor => (createChoiceExecutor());

const createTemplateChoice = (templatePath: string): ITemplateChoice => ({
	...templateChoiceFixture(templatePath),
	id: "template-choice-id",
	fileNameFormat: { enabled: false, format: "{{VALUE}}" },
});

describe("runOnePagePreflight selection-as-value", () => {
	beforeEach(() => {
		modalOpenMock.mockClear();
		modalResult = {};
		modalFileSelections = new Map();
		modalMultiSelections = new Map();
		modalFieldLinkSelections = new Map();
	});

	it("prefills {{VALUE}} from selection when enabled", async () => {
		const choice = createChoice();
		const executor = createExecutor();
		const plugin = createPreflightPlugin();

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
		const plugin = createPreflightPlugin();
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
		const plugin = createPreflightPlugin(false);

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
		const plugin = createPreflightPlugin(false);

		await expect(
			runOnePagePreflight(createApp(null), plugin, executor, choice),
		).rejects.toBeInstanceOf(UserCancelError);
	});

	it("does not prefill when selection usage is disabled", async () => {
		const choice = createChoice();
		const executor = createExecutor();
		const plugin = createPreflightPlugin(false);
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

describe("orderOnePageFilePicks", () => {
	it("restores source order for remote arrays and appends unique custom values", () => {
		expect(
			orderOnePageFilePicks(
				["@file:People/B.md", "custom", "@file:People/A.md", "custom"],
				["@file:People/A.md", "@file:People/B.md"],
				true,
			),
		).toEqual(["@file:People/A.md", "@file:People/B.md", "custom"]);
	});

	it("drops unknown values when custom input is disabled", () => {
		expect(
			orderOnePageFilePicks(
				["unknown", "@file:People/B.md"],
				["@file:People/A.md", "@file:People/B.md"],
				false,
			),
		).toEqual(["@file:People/B.md"]);
	});
});

describe("runOnePagePreflight template extension handling", () => {
	beforeEach(() => {
		modalOpenMock.mockClear();
		modalResult = {};
		modalFileSelections = new Map();
		modalDiscoverySelections = new Map();
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

		const plugin = createPreflightPlugin();

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

		const plugin = createPreflightPlugin();

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

	describe("link FIELDs (issue #2295)", () => {
		const templateApp = (body: string) => {
			const templateFile = Object.assign(new TFile(), {
				path: "Templates/Book.md",
				name: "Book.md",
				basename: "Book",
				extension: "md",
			});
			return {
				workspace: { getActiveViewOfType: vi.fn().mockReturnValue(null) },
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => (path === templateFile.path ? templateFile : null)),
					cachedRead: vi.fn(async () => body),
				},
			} as unknown as App;
		};
		const body = "author: {{FIELD:author|link}}\ncategories: {{FIELD:categories|multi|link}}";

		it("asks single and multi link FIELDs in the form and stores their picks as links", async () => {
			modalResult = { "FIELD:author|link": "[[Ted Chiang]]", "FIELD:categories|multi|link": "[[Books]], [[A, B]]" };
			modalFieldLinkSelections = new Map([
				["FIELD:author|link", ["[[Ted Chiang]]"]],
				["FIELD:categories|multi|link", ["[[Books]]", "[[A, B]]"]],
			]);
			const executor = createExecutor();

			const result = await runOnePagePreflight(templateApp(body), createPreflightPlugin(), executor, createTemplateChoice("Templates/Book.md"));

			expect(result).toBe(true);
			expect(executor.variables.get("FIELD:author|link")).toBe("[[Ted Chiang]]");
			expect(executor.variables.get("FIELD:categories|multi|link")).toEqual(["[[Books]]", "[[A, B]]"]);
		});

		it("leaves link FIELDs to the run's picker for a remote client", async () => {
			const requestInputs = vi.fn(async () => ({}));
			const executor = createExecutor();
			(executor as IChoiceExecutor).promptProvider = { requestInputs } as unknown as IChoiceExecutor["promptProvider"];

			const result = await runOnePagePreflight(templateApp(body), createPreflightPlugin(), executor, createTemplateChoice("Templates/Book.md"));

			expect(result).toBe(false);
			expect(requestInputs).not.toHaveBeenCalled();
		});
	});

	it("collects multi FILE picks inline without parsing comma-bearing labels", async () => {
		const templateFile = new TFile();
		templateFile.path = "Templates/People.md";
		templateFile.name = "People.md";
		templateFile.basename = "People";
		templateFile.extension = "md";

		const jane = new TFile();
		jane.path = "People/Doe, Jane.md";
		jane.name = "Doe, Jane.md";
		jane.basename = "Doe, Jane";
		jane.extension = "md";
		(jane as any).parent = { path: "People" };
		const grace = new TFile();
		grace.path = "People/Grace.md";
		grace.name = "Grace.md";
		grace.basename = "Grace";
		grace.extension = "md";
		(grace as any).parent = { path: "People" };

		const app = {
			workspace: {
				getActiveViewOfType: vi.fn().mockReturnValue(null),
				getActiveFile: vi.fn().mockReturnValue(null),
			},
			vault: {
				getAbstractFileByPath: vi.fn((path: string) =>
					path === templateFile.path ? templateFile : null,
				),
				cachedRead: vi.fn(async () =>
					"related: {{FILE:People|link|multi|label:Related people}}",
				),
				getMarkdownFiles: vi.fn(() => [jane, grace]),
			},
			metadataCache: { getFileCache: vi.fn(() => null) },
		} as unknown as App;

		const plugin = createPreflightPlugin();
		const key = parseFileToken(
			"People|link|multi|label:Related people",
		)!.variableKey;
		modalResult = {
			[key]: "@file:People/Doe, Jane.md, @file:People/Grace.md",
		};
		modalFileSelections = new Map([
			[
				key,
				["@file:People/Doe, Jane.md", "@file:People/Grace.md"],
			],
		]);

		const executor = createExecutor();
		const result = await runOnePagePreflight(
			app,
			plugin,
			executor,
			createTemplateChoice(templateFile.path),
		);

		expect(result).toBe(true);
		expect(modalOpenMock).toHaveBeenCalledTimes(1);
		expect(executor.variables.get(key)).toEqual([
			"@file:People/Doe, Jane.md",
			"@file:People/Grace.md",
		]);
	});

	describe("multi-select suggesters", () => {
		const templateApp = (content: string) => {
			const templateFile = new TFile();
			templateFile.path = "Templates/Tags.md";
			templateFile.name = "Tags.md";
			templateFile.basename = "Tags";
			templateFile.extension = "md";
			return {
				workspace: { getActiveViewOfType: vi.fn().mockReturnValue(null) },
				vault: {
					getAbstractFileByPath: vi.fn((path: string) => (path === templateFile.path ? templateFile : null)),
					cachedRead: vi.fn(async () => content),
				},
			} as unknown as App;
		};
		const commaList = 'tags: {{VALUE:"A string, with stuff after a comma",other|text:"First, label",Other|multi|name:tags}}';

		it("stores a {{VALUE|multi}} field's picked values from the form", async () => {
			modalResult = { tags: "A string, with stuff after a comma, other" };
			modalMultiSelections = new Map([["tags", ["A string, with stuff after a comma", "other"]]]);
			const executor = createExecutor();

			await runOnePagePreflight(
				templateApp(commaList),
				createPreflightPlugin(),
				executor,
				createTemplateChoice("Templates/Tags.md"),
			);

			expect(executor.variables.get("tags")).toEqual(["A string, with stuff after a comma", "other"]);
		});

		it("maps a remote client's array of comma-bearing labels back to values", async () => {
			const executor = createExecutor();
			(executor as IChoiceExecutor).promptProvider = {
				requestInputs: vi.fn(async () => ({ tags: ["First, label", "other", "unlisted"] })),
			} as unknown as IChoiceExecutor["promptProvider"];

			await runOnePagePreflight(
				templateApp(commaList),
				createPreflightPlugin(),
				executor,
				createTemplateChoice("Templates/Tags.md"),
			);

			expect(executor.variables.get("tags")).toEqual(["A string, with stuff after a comma", "other"]);
		});

		it("stores a script's multi-select as its requestInputs call will return it", async () => {
			const options = ["A string, with stuff after a comma", "Another"];
			vi.mocked(loadUserScript).mockResolvedValue({
				script: {
					quickadd: {
						inputs: [
							{ id: "joined", type: "suggester", options, suggesterConfig: { multiSelect: true, separator: " | " } },
							{ id: "list", type: "suggester", options, suggesterConfig: { multiSelect: true, returnArray: true } },
						],
					},
				},
				settings: undefined,
			});
			const picks = ["A string, with stuff after a comma", "Typed, custom"];
			modalResult = { joined: picks.join(" | "), list: picks.join(", ") };
			modalMultiSelections = new Map([["joined", picks], ["list", picks]]);
			const macro: IMacroChoice = {
				id: "macro",
				name: "Macro",
				type: "Macro",
				command: false,
				runOnStartup: false,
				macro: {
					id: "macro",
					name: "Macro",
					commands: [{ id: "script", name: "Script", type: CommandType.UserScript, path: "script.js", settings: {} } as IUserScript],
				},
			};
			const executor = createExecutor();

			await runOnePagePreflight(createApp(null), createPreflightPlugin(), executor, macro);

			expect(executor.variables.get("joined")).toBe("A string, with stuff after a comma | Typed, custom");
			expect(executor.variables.get("list")).toEqual(picks);
		});
	});

	it("collects the default Template note selection inline without seeding public value", async () => {
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

		const plugin = createPreflightPlugin();

		const choice = createTemplateChoice("Templates/Daily.md");
		choice.discoverExistingNotesBeforeCreate = true;
		choice.fileNameFormat = { enabled: true, format: "{{VALUE}}" };
		modalDiscoverySelections.set(`__qa.note.${choice.id}`, { kind: "create", title: "New note" });

		const executor = createExecutor();

		const result = await runOnePagePreflight(app, plugin, executor, choice);

		expect(result).toBe(true);
		expect(modalOpenMock).toHaveBeenCalledTimes(1);
		expect(executor.variables.has("value")).toBe(false);
		await withPreparedChoiceInputs(executor, choice.id, async () => {
			expect(getPreparedTemplateNoteSelection(executor, choice.id))
				.toEqual({ kind: "create", title: "New note" });
		});
	});

	it("collects Template creation inputs with inline discovery and applies them at execution", async () => {
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

		const plugin = createPreflightPlugin();

		const choice = createTemplateChoice("Templates/Project.md");
		choice.discoverExistingNotesBeforeCreate = true;
		choice.fileNameFormat = { enabled: true, format: "{{VALUE}}" };

		const executor = createExecutor();
		modalResult = { project: "Atlas" };
		modalDiscoverySelections.set(`__qa.note.${choice.id}`, { kind: "create", title: "New note" });

		const result = await runOnePagePreflight(app, plugin, executor, choice);

		expect(result).toBe(true);
		expect(executor.variables.has("value")).toBe(false);
		expect(executor.variables.has("project")).toBe(false);
		await withPreparedChoiceInputs(executor, choice.id, async () => {
			expect(executor.variables.get("project")).toBe("Atlas");
		});
		expect(modalOpenMock).toHaveBeenCalledTimes(1);
		const requirements = modalOpenMock.mock.calls[0][1] as Array<{ id: string }>;
		expect(requirements.map((requirement) => requirement.id)).toEqual([
			`__qa.note.${choice.id}`,
			"project",
		]);
	});
});
