import { beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import type { App } from "obsidian";
import { runOnePagePreflight } from "./runOnePagePreflight";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";

vi.mock("src/logger/logManager", () => ({
	log: { logWarning: vi.fn(), logError: vi.fn(), logMessage: vi.fn() },
}));

/** Captures the `computePreview` callback the modal is constructed with. */
let computePreview:
	| ((values: Record<string, string>) => Promise<Record<string, string>>)
	| null = null;

vi.mock("./OnePageInputModal", () => ({
	OnePageInputModal: class {
		constructor(
			_app: unknown,
			_requirements: unknown,
			_variables: unknown,
			preview: (
				values: Record<string, string>,
			) => Promise<Record<string, string>>,
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

const createChoice = (fileNameFormat: string): ITemplateChoice =>
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
		expect(out.fileName).toBe("Notes/name-My Note");
		expect(out.fileName).not.toContain("\n");
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
		expect(out.fileName).toBe("Log-My Note -My Note");
	});

	it("says the run would abort when the include does not exist", async () => {
		await runOnePagePreflight(
			createApp(),
			createPlugin(),
			createExecutor(),
			createChoice("{{TEMPLATE:Gone.md}}-{{VALUE:title}}"),
		);

		const out = await computePreview!({ title: "My Note" });
		expect(out.fileName).toBe("[QuickAdd: template not found] Gone.md-My Note");
	});
});
