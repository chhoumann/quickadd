import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../formatters/completeFormatter", () => {
	class CompleteFormatterMock {
		setLinkToCurrentFileBehavior() {}
		setTitle() {}
		async formatFileContent(input: string) {
			return input;
		}
		async formatFileName(format: string) {
			return format;
		}
		async formatFolderPath(folder: string) {
			return folder;
		}
		async withTemplatePropertyCollection<T>(work: () => Promise<T>) {
			return await work();
		}
		getAndClearTemplatePropertyVars() {
			return new Map<string, unknown>();
		}
	}

	return { CompleteFormatter: CompleteFormatterMock };
});

vi.mock("../utilityObsidian", () => ({
	getTemplater: vi.fn(() => ({})),
	overwriteTemplaterOnce: vi.fn(),
	templaterParseTemplate: vi.fn(
		async (_app: unknown, content: string) => content,
	),
}));

import { TFile, type App } from "obsidian";
import type QuickAdd from "../main";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import {
	TemplateInsertEngine,
	insertBodyIntoNoteContent,
	isTemplateInsertMode,
	splitTemplateFrontmatter,
	type TemplateInsertModeId,
} from "./TemplateInsertEngine";

const TEMPLATE_PATH = "templates/tpl.md";

function makeFile(overrides: Partial<TFile> = {}): TFile {
	const file = new TFile();
	file.path = "notes/My note.md";
	file.basename = "My note";
	file.extension = "md";
	Object.assign(file, overrides);
	return file;
}

function makeTemplateChoice(
	overrides: Partial<ITemplateChoice> = {},
): ITemplateChoice {
	return {
		name: "Meeting note",
		id: "choice-id",
		type: "Template",
		command: false,
		templatePath: TEMPLATE_PATH,
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
		...overrides,
	};
}

interface TestHarness {
	app: App;
	modify: ReturnType<typeof vi.fn>;
	frontmatter: Record<string, unknown>;
	replaceSelection: ReturnType<typeof vi.fn>;
	setActiveViewFile: (file: TFile | null) => void;
}

function makeHarness(options: {
	templateContent: string;
	noteContent: string;
	frontmatter?: Record<string, unknown>;
}): TestHarness {
	const templateFile = makeFile({
		path: TEMPLATE_PATH,
		basename: "tpl",
	});

	const modify = vi.fn();
	const frontmatter = options.frontmatter ?? {};
	const replaceSelection = vi.fn();
	let activeViewFile: TFile | null = null;

	const app = {
		vault: {
			getAbstractFileByPath: (path: string) =>
				path === TEMPLATE_PATH ? templateFile : null,
			cachedRead: async (file: TFile) =>
				file.path === TEMPLATE_PATH
					? options.templateContent
					: options.noteContent,
			modify,
		},
		fileManager: {
			processFrontMatter: async (
				_file: TFile,
				fn: (fm: Record<string, unknown>) => void,
			) => {
				fn(frontmatter);
			},
		},
		workspace: {
			getActiveViewOfType: () =>
				activeViewFile
					? { file: activeViewFile, editor: { replaceSelection } }
					: null,
		},
	} as unknown as App;

	return {
		app,
		modify,
		frontmatter,
		replaceSelection,
		setActiveViewFile: (file) => {
			activeViewFile = file;
		},
	};
}

function makeEngine(
	harness: TestHarness,
	file: TFile,
	mode: TemplateInsertModeId,
): TemplateInsertEngine {
	return new TemplateInsertEngine(
		harness.app,
		{} as QuickAdd,
		file,
		TEMPLATE_PATH,
		mode,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("isTemplateInsertMode", () => {
	it("accepts all known modes", () => {
		for (const mode of ["cursor", "top", "bottom", "replace"]) {
			expect(isTemplateInsertMode(mode)).toBe(true);
		}
	});

	it("rejects unknown values", () => {
		expect(isTemplateInsertMode("prepend")).toBe(false);
		expect(isTemplateInsertMode(undefined)).toBe(false);
		expect(isTemplateInsertMode(1)).toBe(false);
	});
});

describe("splitTemplateFrontmatter", () => {
	it("returns full content as body when there is no frontmatter", () => {
		const result = splitTemplateFrontmatter("# Heading\nBody");
		expect(result.frontmatterYaml).toBeNull();
		expect(result.body).toBe("# Heading\nBody");
	});

	it("splits frontmatter from body", () => {
		const result = splitTemplateFrontmatter(
			"---\ntags: [a, b]\nstatus: draft\n---\n# Heading\nBody",
		);
		expect(result.frontmatterYaml).toBe("tags: [a, b]\nstatus: draft");
		expect(result.body).toBe("# Heading\nBody");
	});

	it("handles frontmatter-only templates", () => {
		const result = splitTemplateFrontmatter("---\nstatus: draft\n---\n");
		expect(result.frontmatterYaml).toBe("status: draft");
		expect(result.body.trim()).toBe("");
	});
});

describe("insertBodyIntoNoteContent", () => {
	it("appends to the bottom", () => {
		expect(insertBodyIntoNoteContent("existing", "new", "bottom")).toBe(
			"existing\nnew",
		);
	});

	it("inserts at the top when the note has no frontmatter", () => {
		expect(insertBodyIntoNoteContent("existing", "new", "top")).toBe(
			"new\nexisting",
		);
	});

	it("inserts below the note's frontmatter for top", () => {
		const note = "---\ntitle: Note\n---\nexisting";
		expect(insertBodyIntoNoteContent(note, "new", "top")).toBe(
			"---\ntitle: Note\n---\nnew\nexisting",
		);
	});
});

describe("TemplateInsertEngine.apply", () => {
	it("replace: overwrites the note with the formatted template", async () => {
		const harness = makeHarness({
			templateContent: "TEMPLATE_CONTENT",
			noteContent: "OLD",
		});
		const file = makeFile();

		const result = await makeEngine(harness, file, "replace").apply();

		expect(result).toBe(file);
		expect(harness.modify).toHaveBeenCalledWith(file, "TEMPLATE_CONTENT");
	});

	it("bottom: appends the template body to the note", async () => {
		const harness = makeHarness({
			templateContent: "TEMPLATE_CONTENT",
			noteContent: "EXISTING",
		});
		const file = makeFile();

		await makeEngine(harness, file, "bottom").apply();

		expect(harness.modify).toHaveBeenCalledWith(
			file,
			"EXISTING\nTEMPLATE_CONTENT",
		);
	});

	it("top: inserts body below note frontmatter and merges template properties with existing-wins", async () => {
		const harness = makeHarness({
			templateContent: "---\nstatus: draft\npriority: high\n---\nTPL_BODY",
			noteContent: "---\nstatus: done\n---\nEXISTING",
			frontmatter: { status: "done" },
		});
		const file = makeFile();

		await makeEngine(harness, file, "top").apply();

		expect(harness.modify).toHaveBeenCalledWith(
			file,
			"---\nstatus: done\n---\nTPL_BODY\nEXISTING",
		);
		// Existing note value wins; missing property is filled from template.
		expect(harness.frontmatter).toEqual({
			status: "done",
			priority: "high",
		});
	});

	it("top: fills empty existing properties from the template", async () => {
		const harness = makeHarness({
			templateContent: "---\nstatus: draft\n---\nTPL_BODY",
			noteContent: "EXISTING",
			frontmatter: { status: null },
		});
		const file = makeFile();

		await makeEngine(harness, file, "top").apply();

		expect(harness.frontmatter).toEqual({ status: "draft" });
	});

	it("frontmatter-only template: merges properties without touching the body", async () => {
		const harness = makeHarness({
			templateContent: "---\nstatus: draft\n---\n",
			noteContent: "EXISTING",
		});
		const file = makeFile();

		await makeEngine(harness, file, "bottom").apply();

		expect(harness.modify).not.toHaveBeenCalled();
		expect(harness.frontmatter).toEqual({ status: "draft" });
	});

	it("cursor: inserts the template body via the active editor", async () => {
		const harness = makeHarness({
			templateContent: "TEMPLATE_CONTENT",
			noteContent: "EXISTING",
		});
		const file = makeFile();
		harness.setActiveViewFile(file);

		const result = await makeEngine(harness, file, "cursor").apply();

		expect(result).toBe(file);
		expect(harness.replaceSelection).toHaveBeenCalledWith("TEMPLATE_CONTENT");
		expect(harness.modify).not.toHaveBeenCalled();
	});

	it("cursor: throws when the note is not open in the active editor", async () => {
		const harness = makeHarness({
			templateContent: "TEMPLATE_CONTENT",
			noteContent: "EXISTING",
		});
		const file = makeFile();

		await expect(makeEngine(harness, file, "cursor").apply()).rejects.toThrow(
			/not open in the active editor/,
		);
	});
});

describe("TemplateInsertEngine.computeChoiceTargetPath", () => {
	function makePathHarness() {
		return makeHarness({ templateContent: "", noteContent: "" });
	}

	it("returns renamed path in the note's folder when only file name format is set", async () => {
		const harness = makePathHarness();
		const file = makeFile({ parent: { path: "notes" } as TFile["parent"] });
		const choice = makeTemplateChoice({
			fileNameFormat: { enabled: true, format: "Renamed" },
		});

		const target = await makeEngine(
			harness,
			file,
			"replace",
		).computeChoiceTargetPath(choice);

		expect(target).toBe("notes/Renamed.md");
	});

	it("uses the choice's single configured folder", async () => {
		const harness = makePathHarness();
		const file = makeFile({ parent: { path: "notes" } as TFile["parent"] });
		const choice = makeTemplateChoice({
			folder: {
				enabled: true,
				folders: ["Meetings"],
				chooseWhenCreatingNote: false,
				createInSameFolderAsActiveFile: false,
				chooseFromSubfolders: false,
			},
		});

		const target = await makeEngine(
			harness,
			file,
			"replace",
		).computeChoiceTargetPath(choice);

		expect(target).toBe("Meetings/My note.md");
	});

	it("returns null when the folder requires a runtime picker", async () => {
		const harness = makePathHarness();
		const file = makeFile();

		for (const folderOverride of [
			{ chooseWhenCreatingNote: true },
			{ chooseFromSubfolders: true },
		]) {
			const choice = makeTemplateChoice({
				folder: {
					enabled: true,
					folders: ["A", "B"],
					chooseWhenCreatingNote: false,
					createInSameFolderAsActiveFile: false,
					chooseFromSubfolders: false,
					...folderOverride,
				},
			});

			const target = await makeEngine(
				harness,
				file,
				"replace",
			).computeChoiceTargetPath(choice);

			expect(target).toBeNull();
		}
	});

	it("returns null with multiple configured folders", async () => {
		const harness = makePathHarness();
		const file = makeFile();
		const choice = makeTemplateChoice({
			folder: {
				enabled: true,
				folders: ["A", "B"],
				chooseWhenCreatingNote: false,
				createInSameFolderAsActiveFile: false,
				chooseFromSubfolders: false,
			},
		});

		const target = await makeEngine(
			harness,
			file,
			"replace",
		).computeChoiceTargetPath(choice);

		expect(target).toBeNull();
	});

	it("keeps the current path when neither folder nor file name format are configured", async () => {
		const harness = makePathHarness();
		const file = makeFile({ parent: { path: "notes" } as TFile["parent"] });
		const choice = makeTemplateChoice();

		const target = await makeEngine(
			harness,
			file,
			"replace",
		).computeChoiceTargetPath(choice);

		expect(target).toBe(file.path);
	});
});
