import { beforeEach, describe, expect, it, vi } from "vitest";

const { engineApplyMock, engineConstructorMock } = vi.hoisted(() => ({
	engineApplyMock: vi.fn(),
	engineConstructorMock: vi.fn(),
}));

vi.mock("./TemplateInsertEngine", async (importOriginal) => {
	const actual = await importOriginal<object>();

	class TemplateInsertEngineMock {
		constructor(...args: unknown[]) {
			engineConstructorMock(...args);
		}
		async apply() {
			return await engineApplyMock();
		}
		async computeChoiceTargetPath() {
			return null;
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
