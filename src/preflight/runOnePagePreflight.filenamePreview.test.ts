import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { runOnePagePreflight } from "./runOnePagePreflight";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";

vi.mock("src/logger/logManager", () => ({
	log: { logWarning: vi.fn(), logError: vi.fn(), logMessage: vi.fn() },
}));

type PreviewRow = {
	label: string;
	text: string;
	diagnostics: readonly { severity: string; message: string; kind?: string }[];
};

/** Captures the `computePreview` callback the modal is constructed with. */
let computePreview:
	| ((values: Record<string, string>) => Promise<PreviewRow[]>)
	| null = null;

vi.mock("./OnePageInputModal", () => ({
	OnePageInputModal: class {
		constructor(
			_app: unknown,
			_requirements: unknown,
			_variables: unknown,
			preview: (values: Record<string, string>) => Promise<PreviewRow[]>,
		) {
			computePreview = preview;
		}
		get waitForClose() {
			return Promise.resolve({ title: "My Note" });
		}
	},
}));

vi.mock("src/quickAddSettingsTab", () => ({ QuickAddSettingsTab: class {} }));
vi.mock("src/main", () => ({ __esModule: true, default: class {} }));
vi.mock("obsidian-dataview", () => ({
	__esModule: true,
	getAPI: vi.fn().mockReturnValue(null),
}));
vi.mock("src/utilityObsidian", async () => {
	const { TFile: TFileCls } = await import("obsidian");
	return {
		getMarkdownFilesInFolder: vi.fn(() => []),
		getMarkdownFilesWithTag: vi.fn(() => []),
		getUserScript: vi.fn(),
		isFolder: vi.fn(() => false),
		// A configured folder can hold {{DATE:}}, which the requirement scan
		// resolves through this helper.
		getDate: ({ format }: { format: string }) => format,
		getTemplateFile: vi.fn((app: App, path: string) => {
			const f = app.vault.getAbstractFileByPath(path);
			return f instanceof TFileCls ? f : null;
		}),
	};
});

const createApp = (templates: Record<string, string> = {}) =>
	({
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(null),
			getActiveFile: () => null,
		},
		vault: {
			getAbstractFileByPath: vi.fn((path: string) =>
				path in templates
					? Object.assign(new TFile(), {
							path,
							extension: "md",
							basename: path.replace(/\.md$/, ""),
						})
					: null,
			),
			getMarkdownFiles: () => [],
			cachedRead: async (file: { path: string }) => templates[file.path],
		},
		metadataCache: { getFileCache: () => null, getAllPropertyInfos: () => ({}) },
	}) as unknown as App;

const createChoice = (
	fileNameFormat: string,
	folder?: Partial<ITemplateChoice["folder"]>,
): ITemplateChoice =>
	({
		id: "tmpl",
		name: "Template Choice",
		type: "Template",
		command: false,
		templatePath: "",
		fileNameFormat: { enabled: true, format: fileNameFormat },
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
			...folder,
		},
		appendLink: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "default",
			focus: true,
		},
		fileExistsMode: "Increment the file name",
		setFileExistsBehavior: false,
	}) as unknown as ITemplateChoice;

const createExecutor = (): IChoiceExecutor => ({
	execute: vi.fn(),
	variables: new Map<string, unknown>(),
});

const createPlugin = () =>
	({
		settings: {
			inputPrompt: "single-line",
			globalVariables: {},
			useSelectionAsCaptureValue: false,
		},
	}) as never;

beforeEach(() => {
	computePreview = null;
});

/**
 * The one-page form's live preview previews a FILE NAME, but built a
 * `FormatDisplayFormatter` - the note-CONTENT formatter - so it expanded `\n`
 * escapes into real linebreaks, which are not linebreaks in a path.
 * `FileNameDisplayFormatter` is what `formatFileName` mirrors at run time, and
 * what the builder's own file-name preview already uses.
 */
describe("one-page preflight previews the file name with the file-name formatter", () => {
	it("treats a backslash-n as a path separator, not as a linebreak", async () => {
		await runOnePagePreflight(
			createApp(),
			createPlugin(),
			createExecutor(),
			createChoice(String.raw`Notes\name-{{VALUE:title}}`),
		);

		expect(computePreview).not.toBeNull();
		const out = await computePreview!({ title: "My Note" });
		// Not a linebreak (that is the content formatter's rule, and this is a
		// path); a separator, because that is what the run makes of it -
		// `normalizeGeneratedFilePath` rewrites "\" to "/" before the note is
		// created, exactly as Obsidian's own `normalizePath` does (#1563).
		expect(out[0].text).toBe("Notes/name-My Note");
		expect(out[0].text).not.toContain("\n");
		expect(out[0].label).toBe("File name");
	});

	it("resolves a {{TEMPLATE:}} include the way the run does", async () => {
		// The requirement scan behind this same modal already walks into the
		// include, so leaving the token literal here made the form ask for a
		// variable and then preview the question instead of the answer (#1563).
		await runOnePagePreflight(
			createApp({ "Naming.md": "Log-{{VALUE:title}}\n" }),
			createPlugin(),
			createExecutor(),
			createChoice("{{TEMPLATE:Naming.md}}-{{VALUE:title}}"),
		);

		const out = await computePreview!({ title: "My Note" });
		// The template file's trailing newline is not part of the name: the run's
		// normalizer collapses the control run and the space around it, so the
		// seam between the include and "-My Note" reads the same in both.
		expect(out[0].text).toBe("Log-My Note -My Note");
	});

	it("says the run would abort when the include does not exist", async () => {
		await runOnePagePreflight(
			createApp(),
			createPlugin(),
			createExecutor(),
			createChoice("{{TEMPLATE:Gone.md}}-{{VALUE:title}}"),
		);

		const out = await computePreview!({ title: "My Note" });
		expect(out[0].text).toBe("[QuickAdd: template not found] Gone.md-My Note");
		// The diagnostic used to be dropped on the floor here: computePreview
		// returned strings and the modal rendered only those (#1590).
		expect(out[0].diagnostics).toEqual([
			{ severity: "error", message: "Template not found: Gone.md" },
		]);
	});
});

describe("the one-page preview carries its problems and its target folder (#1590)", () => {
	it("reports a name Obsidian will refuse, with the user's real answer in it", async () => {
		await runOnePagePreflight(
			createApp(),
			createPlugin(),
			createExecutor(),
			createChoice("Bad: {{VALUE:title}}"),
		);

		const out = await computePreview!({ title: "My Note" });
		expect(out[0].text).toBe("Bad: My Note");
		expect(out[0].diagnostics).toEqual([
			{
				severity: "error",
				kind: "path",
				message:
					'A file or folder name cannot contain ":", so this choice would fail at run time. Check your own text and tokens like {{TIME}}, which is HH:mm.',
			},
		]);
	});

	it("resolves {{FOLDER}} against the choice's single configured folder", async () => {
		// Nothing called setTargetFolderPath, so this rendered `Notes//x` plus an
		// empty-segment error nobody could see.
		await runOnePagePreflight(
			createApp(),
			createPlugin(),
			createExecutor(),
			createChoice("Notes/{{FOLDER}}/{{VALUE:title}}", {
				enabled: true,
				folders: ["Work"],
			}),
		);

		const out = await computePreview!({ title: "My Note" });
		expect(out[0].text).toBe("Notes/Work/My Note");
		expect(out[0].diagnostics).toEqual([]);
	});

	it("falls back to the builder's placeholder when the run has not picked a folder", async () => {
		// Two configured folders means the run opens a suggester, so no folder can
		// be promised - but an empty string would produce `Notes//x` and a false
		// "empty path segment" error on a choice that works.
		await runOnePagePreflight(
			createApp(),
			createPlugin(),
			createExecutor(),
			createChoice("Notes/{{FOLDER}}/{{VALUE:title}}", {
				enabled: true,
				folders: ["Work", "Personal"],
			}),
		);

		const out = await computePreview!({ title: "My Note" });
		expect(out[0].text).toBe("Notes/Folder/Name/My Note");
		expect(out[0].diagnostics).toEqual([]);
	});

	it("does not splice a format token out of a configured folder into the name", async () => {
		// The run formats the folder first (formatFolderPath); setTargetFolderPath
		// does not. Handing over the raw text would put the literal token in the
		// name AND raise the colon error from the token's own syntax.
		await runOnePagePreflight(
			createApp(),
			createPlugin(),
			createExecutor(),
			createChoice("{{FOLDER}}/{{VALUE:title}}", {
				enabled: true,
				folders: ["Journal/{{DATE:YYYY-MM}}"],
			}),
		);

		const out = await computePreview!({ title: "My Note" });
		expect(out[0].text).toBe("Folder/Name/My Note");
		expect(out[0].diagnostics).toEqual([]);
	});
});
