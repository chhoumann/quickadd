import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	engineApplyMock,
	engineConstructorMock,
	resolvedPathMock,
	setPromptRunContextMock,
	targetPathMock,
	yesNoPromptMock,
	suggestMock,
} =
	vi.hoisted(() => ({
		engineApplyMock: vi.fn(),
		engineConstructorMock: vi.fn(),
		setPromptRunContextMock: vi.fn<(context: unknown) => void>(),
		// Identity by default (raw == resolved); override to simulate a path token
		// that resolves to a different extension (issue #620).
		resolvedPathMock: vi.fn((raw: string) => raw),
		// null by default: no move offer. Override to drive the reconcile path.
		targetPathMock: vi.fn<() => Promise<string | null>>(async () => null),
		yesNoPromptMock: vi.fn(async () => true),
		suggestMock: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
	}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: { Suggest: (...args: unknown[]) => suggestMock(...args) },
}));

vi.mock("../gui/GenericYesNoPrompt/GenericYesNoPrompt", () => ({
	default: { Prompt: (...args: unknown[]) => yesNoPromptMock(...(args as [])) },
}));

vi.mock("./TemplateInsertEngine", async (importOriginal) => {
	const actual = await importOriginal<object>();

	class TemplateInsertEngineMock {
		templatePath: string;
		constructor(...args: unknown[]) {
			engineConstructorMock(...args);
			this.templatePath = args[3] as string;
		}
		async getResolvedTemplatePath() {
			return resolvedPathMock(this.templatePath);
		}
		async apply() {
			return await engineApplyMock();
		}
		async computeChoiceTargetPath() {
			return await targetPathMock();
		}
		setPromptRunContext(context: unknown) {
			setPromptRunContextMock(context);
		}
	}

	return { ...actual, TemplateInsertEngine: TemplateInsertEngineMock };
});

vi.mock("../utilityObsidian", () => ({
	jumpToNextTemplaterCursorIfPossible: vi.fn(),
	getTemplater: vi.fn(() => ({})),
	templaterParseTemplate: vi.fn(
		async (_app: unknown, content: string) => content,
	),
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

import { TFile, type App } from "obsidian";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import type QuickAdd from "../main";
import type IChoice from "../types/choices/IChoice";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type IMultiChoice from "../types/choices/IMultiChoice";
import {
	applyTemplateToNote,
	buildTemplatePickerItems,
	isMarkdownTemplatePath,
	isNoteEffectivelyEmpty,
	templatePickerItemLabel,
} from "./applyTemplateToActiveNote";

function makeTemplateChoice(
	name: string,
	templatePath: string,
): ITemplateChoice {
	return {
		name,
		id: `id-${name}`,
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
		fileNameFormat: { enabled: false, format: "" },
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "source",
			focus: false,
		},
		fileExistsBehavior: { kind: "prompt" },
	};
}

function makeMultiChoice(name: string, choices: IChoice[]): IMultiChoice {
	return {
		name,
		id: `id-${name}`,
		type: "Multi",
		command: false,
		choices,
		collapsed: false,
	};
}

describe("isNoteEffectivelyEmpty", () => {
	it("treats empty and whitespace-only content as empty", () => {
		expect(isNoteEffectivelyEmpty("")).toBe(true);
		expect(isNoteEffectivelyEmpty("  \n\t\n")).toBe(true);
	});

	it("treats any non-whitespace content as non-empty", () => {
		expect(isNoteEffectivelyEmpty("x")).toBe(false);
		expect(isNoteEffectivelyEmpty("\n# Heading\n")).toBe(false);
	});
});

describe("isMarkdownTemplatePath", () => {
	it("accepts markdown and extensionless template paths", () => {
		expect(isMarkdownTemplatePath("templates/tpl.md")).toBe(true);
		expect(isMarkdownTemplatePath("templates/tpl")).toBe(true);
	});

	it("rejects canvas and base templates", () => {
		expect(isMarkdownTemplatePath("templates/board.canvas")).toBe(false);
		expect(isMarkdownTemplatePath("templates/db.base")).toBe(false);
		expect(isMarkdownTemplatePath("templates/Board.CANVAS")).toBe(false);
	});
});

describe("buildTemplatePickerItems", () => {
	it("lists Template choices first, then uncovered template files", () => {
		const choices: IChoice[] = [
			makeTemplateChoice("Meeting", "templates/meeting.md"),
		];
		const items = buildTemplatePickerItems(choices, [
			"templates/meeting.md",
			"templates/other.md",
		]);

		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ kind: "choice" });
		expect(items[1]).toEqual({ kind: "file", path: "templates/other.md" });
	});

	it("flattens Template choices nested in Multi choices", () => {
		const nested = makeTemplateChoice("Nested", "templates/nested.md");
		const choices: IChoice[] = [makeMultiChoice("Folder", [nested])];

		const items = buildTemplatePickerItems(choices, []);

		expect(items).toEqual([{ kind: "choice", choice: nested }]);
	});

	it("dedupes template files against choice template paths without extension", () => {
		const choices: IChoice[] = [
			makeTemplateChoice("Meeting", "templates/meeting"),
		];

		const items = buildTemplatePickerItems(choices, [
			"templates/meeting.md",
		]);

		expect(items).toHaveLength(1);
		expect(items[0].kind).toBe("choice");
	});

	it("excludes canvas and base templates from choices and files", () => {
		const choices: IChoice[] = [
			makeTemplateChoice("Canvas board", "templates/board.canvas"),
			makeTemplateChoice("Base db", "templates/db.base"),
			makeTemplateChoice("Note", "templates/note.md"),
		];

		const items = buildTemplatePickerItems(choices, [
			"templates/other.canvas",
			"templates/other.base",
			"templates/other.md",
		]);

		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({
			kind: "choice",
			choice: { name: "Note" },
		});
		expect(items[1]).toEqual({ kind: "file", path: "templates/other.md" });
	});

	it("skips non-Template choices and Template choices without a template path", () => {
		const choices: IChoice[] = [
			makeTemplateChoice("Empty", ""),
			{
				name: "Capture",
				id: "id-capture",
				type: "Capture",
				command: false,
			} as IChoice,
		];

		expect(buildTemplatePickerItems(choices, [])).toEqual([]);
	});
});

describe("templatePickerItemLabel", () => {
	it("labels choices and files distinctly", () => {
		const choice = makeTemplateChoice("Meeting", "templates/meeting.md");
		expect(templatePickerItemLabel({ kind: "choice", choice })).toBe(
			"Choice: Meeting",
		);
		expect(
			templatePickerItemLabel({ kind: "file", path: "templates/x.md" }),
		).toBe("Template: templates/x.md");
	});
});

describe("applyTemplateToNote (non-interactive)", () => {
	function makeFile(): TFile {
		const file = new TFile();
		file.path = "notes/My note.md";
		file.basename = "My note";
		file.extension = "md";
		return file;
	}

	function makeApp(noteContent: string, activeFile: TFile | null): App {
		return {
			workspace: { getActiveFile: () => activeFile },
			vault: { cachedRead: async () => noteContent },
		} as unknown as App;
	}

	function makeExecutor(): IChoiceExecutor {
		return {
			execute: async () => {},
			variables: new Map<string, unknown>(),
		};
	}

	const plugin = {} as QuickAdd;

	beforeEach(() => {
		vi.clearAllMocks();
		engineApplyMock.mockImplementation(async () => makeFile());
	});

	it("uses the empty-note fast path (replace) for empty notes", async () => {
		const file = makeFile();
		const result = await applyTemplateToNote(makeApp("", file), plugin, {
			templatePath: "templates/tpl.md",
			choiceExecutor: makeExecutor(),
		});

		expect(result).toBe(file);
		expect(engineConstructorMock).toHaveBeenCalledTimes(1);
		expect(engineConstructorMock.mock.calls[0][4]).toBe("replace");
	});

	it("defaults to bottom for non-empty notes", async () => {
		const file = makeFile();
		await applyTemplateToNote(makeApp("CONTENT", file), plugin, {
			templatePath: "templates/tpl.md",
			choiceExecutor: makeExecutor(),
		});

		expect(engineConstructorMock.mock.calls[0][4]).toBe("bottom");
	});

	it("respects an explicit mode even for empty notes", async () => {
		const file = makeFile();
		await applyTemplateToNote(makeApp("", file), plugin, {
			templatePath: "templates/tpl.md",
			mode: "top",
			choiceExecutor: makeExecutor(),
		});

		expect(engineConstructorMock.mock.calls[0][4]).toBe("top");
	});

	// issue #1546: prompts raised while applying a template say which choice is
	// driving and which note is being written, and get a stable per-source draft
	// scope so one source's cancelled draft cannot pre-fill another's.
	it("hands the engine a run context naming the target note", async () => {
		const file = makeFile();
		await applyTemplateToNote(makeApp("CONTENT", file), plugin, {
			templatePath: "templates/tpl.md",
			choiceExecutor: makeExecutor(),
		});

		expect(setPromptRunContextMock).toHaveBeenCalledWith({
			choiceName: undefined,
			draftScopeId: "template-insert#templates/tpl.md",
			destination: file.path,
			destinationKind: "file",
		});
	});

	it("keeps the draft scope stable across applications of the same template", async () => {
		// Two runs of the same bare template must share a draft key, so a
		// cancelled answer is restored on the retry; a different template must not.
		const file = makeFile();
		for (const templatePath of [
			"templates/tpl.md",
			"templates/tpl.md",
			"templates/other.md",
		]) {
			await applyTemplateToNote(makeApp("CONTENT", file), plugin, {
				templatePath,
				choiceExecutor: makeExecutor(),
			});
		}

		const scopes = setPromptRunContextMock.mock.calls.map(
			([context]) => (context as { draftScopeId?: string }).draftScopeId,
		);
		expect(scopes).toEqual([
			"template-insert#templates/tpl.md",
			"template-insert#templates/tpl.md",
			"template-insert#templates/other.md",
		]);
	});

	it("pre-fills {{VALUE}} with the note's basename", async () => {
		const file = makeFile();
		const executor = makeExecutor();
		await applyTemplateToNote(makeApp("CONTENT", file), plugin, {
			templatePath: "templates/tpl.md",
			choiceExecutor: executor,
		});

		expect(executor.variables.get("value")).toBe("My note");
	});

	it("keeps a pre-existing value variable", async () => {
		const file = makeFile();
		const executor = makeExecutor();
		executor.variables.set("value", "Custom");

		await applyTemplateToNote(makeApp("CONTENT", file), plugin, {
			templatePath: "templates/tpl.md",
			choiceExecutor: executor,
		});

		expect(executor.variables.get("value")).toBe("Custom");
	});

	it("seeds the trigger context with the target note, then restores it (issue #1429)", async () => {
		const file = makeFile();
		const executor = makeExecutor();
		let contextDuringApply: unknown;
		engineApplyMock.mockImplementationOnce(async () => {
			contextDuringApply = (
				executor as unknown as { triggerContext?: unknown }
			).triggerContext;
			return file;
		});

		await applyTemplateToNote(makeApp("CONTENT", file), plugin, {
			templatePath: "templates/tpl.md",
			choiceExecutor: executor,
		});

		// During apply, default-from:active resolves against the target note...
		expect(contextDuringApply).toEqual({ activeFile: file });
		// ...and the executor is restored afterward so a reused executor (a script
		// applying templates to several notes) never leaks the stale note.
		expect(
			(executor as unknown as { triggerContext?: unknown }).triggerContext,
		).toBeUndefined();
	});

	it("does not clobber a caller-supplied trigger context", async () => {
		const file = makeFile();
		const callerContext = { activeFile: makeFile() };
		const executor = makeExecutor();
		const ctx = () =>
			(executor as unknown as { triggerContext?: unknown }).triggerContext;
		(executor as unknown as { triggerContext?: unknown }).triggerContext =
			callerContext;
		let contextDuringApply: unknown;
		engineApplyMock.mockImplementationOnce(async () => {
			contextDuringApply = ctx();
			return file;
		});

		await applyTemplateToNote(makeApp("CONTENT", file), plugin, {
			templatePath: "templates/tpl.md",
			choiceExecutor: executor,
		});

		expect(contextDuringApply).toBe(callerContext);
		expect(ctx()).toBe(callerContext);
	});

	it("returns null without an active markdown note", async () => {
		const result = await applyTemplateToNote(makeApp("", null), plugin, {
			templatePath: "templates/tpl.md",
			choiceExecutor: makeExecutor(),
		});

		expect(result).toBeNull();
		expect(engineConstructorMock).not.toHaveBeenCalled();
	});

	it("returns null for non-markdown files", async () => {
		const file = makeFile();
		file.extension = "canvas";

		const result = await applyTemplateToNote(makeApp("", file), plugin, {
			templatePath: "templates/tpl.md",
			choiceExecutor: makeExecutor(),
		});

		expect(result).toBeNull();
		expect(engineConstructorMock).not.toHaveBeenCalled();
	});

	it("returns null for canvas and base templates", async () => {
		const file = makeFile();

		for (const templatePath of [
			"templates/board.canvas",
			"templates/db.base",
		]) {
			const result = await applyTemplateToNote(makeApp("", file), plugin, {
				templatePath,
				choiceExecutor: makeExecutor(),
			});

			expect(result).toBeNull();
		}

		expect(engineConstructorMock).not.toHaveBeenCalled();
	});

	it("rejects a markdown-looking path that RESOLVES to a canvas/base template (#620)", async () => {
		const file = makeFile();
		// Raw path is extensionless → passes the early markdown check; it resolves
		// to a .canvas template, which must not be applied to a markdown note.
		resolvedPathMock.mockReturnValueOnce("templates/Board.canvas");

		const result = await applyTemplateToNote(makeApp("CONTENT", file), plugin, {
			templatePath: "templates/{{value:kind}}",
			choiceExecutor: makeExecutor(),
		});

		expect(result).toBeNull();
		// Engine was constructed (to resolve the path) but apply() must not run.
		expect(engineConstructorMock).toHaveBeenCalledTimes(1);
		expect(engineApplyMock).not.toHaveBeenCalled();
	});

	it("returns null when the engine could not apply the template", async () => {
		engineApplyMock.mockResolvedValue(null);
		const file = makeFile();

		const result = await applyTemplateToNote(makeApp("", file), plugin, {
			templatePath: "templates/tpl.md",
			choiceExecutor: makeExecutor(),
		});

		expect(result).toBeNull();
	});
});

/**
 * Issue #1591. Answering "Yes" to the move offer creates the target FOLDER and
 * then fails at `renameFile`, leaving an empty folder behind and reporting it
 * as a warning the user did nothing to deserve. The offer is an optional
 * convenience, so an impossible target declines it quietly.
 */
describe("the move offer refuses an impossible target (#1591)", () => {
	function makeFile(): TFile {
		const file = new TFile();
		file.path = "notes/My note.md";
		file.basename = "My note";
		file.extension = "md";
		return file;
	}

	function makeApp(activeFile: TFile) {
		const createFolder = vi.fn(async () => {});
		const renameFile = vi.fn(async () => {});
		const app = {
			workspace: { getActiveFile: () => activeFile },
			vault: {
				// Empty, so the empty-note fast path picks "replace" and the insert
				// MODE picker is skipped; only the template picker is driven below.
				cachedRead: async () => "",
				adapter: { exists: async () => false },
				createFolder,
			},
			fileManager: { renameFile },
		} as unknown as App;
		return { app, createFolder, renameFile };
	}

	const choice = makeTemplateChoice("Choice", "templates/tpl.md");
	const plugin = {
		settings: { choices: [choice] },
		getTemplateFiles: () => [],
	} as unknown as QuickAdd;
	const executor = (): IChoiceExecutor => ({
		execute: async () => {},
		variables: new Map<string, unknown>(),
	});

	beforeEach(() => {
		vi.clearAllMocks();
		engineApplyMock.mockImplementation(async () => makeFile());
		yesNoPromptMock.mockImplementation(async () => true);
	});

	it("does not ask, create a folder, or rename for a name Obsidian refuses", async () => {
		// The INTERACTIVE path: reconciliation only runs when the template came
		// from a choice picked by the user, so a `templatePath` argument would
		// skip the branch under test entirely.
		suggestMock.mockImplementation(async (_app, _labels, values) => {
			const items = values as Array<unknown>;
			// First call picks the template, second picks the insert mode.
			return typeof items[0] === "string" ? items[0] : items[0];
		});
		targetPathMock.mockImplementation(async () => "Bad: Notes/My note.md");
		const file = makeFile();
		const { app, createFolder, renameFile } = makeApp(file);

		await applyTemplateToNote(app, plugin, {
			file,
			choiceExecutor: executor(),
		});

		expect(targetPathMock).toHaveBeenCalled();
		expect(yesNoPromptMock).not.toHaveBeenCalled();
		expect(createFolder).not.toHaveBeenCalled();
		expect(renameFile).not.toHaveBeenCalled();
	});

	it("still offers the move for a legal target", async () => {
		// The other half, so the case above cannot pass by never reaching the
		// reconcile branch at all.
		suggestMock.mockImplementation(async (_app, _labels, values) =>
			(values as Array<unknown>)[0],
		);
		targetPathMock.mockImplementation(async () => "Notes/My note.md");
		const file = makeFile();
		const { app, renameFile } = makeApp(file);

		await applyTemplateToNote(app, plugin, {
			file,
			choiceExecutor: executor(),
		});

		expect(yesNoPromptMock).toHaveBeenCalled();
		expect(renameFile).toHaveBeenCalled();
	});
});
