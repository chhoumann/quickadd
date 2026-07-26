import { beforeEach, describe, expect, it, vi } from "vitest";
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

const createApp = () =>
	({
		workspace: {
			getActiveViewOfType: vi.fn().mockReturnValue(null),
			getActiveFile: () => null,
		},
		vault: {
			getAbstractFileByPath: vi.fn().mockReturnValue(null),
			getMarkdownFiles: () => [],
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
 * `FormatDisplayFormatter` - the note-CONTENT formatter. It therefore expanded
 * `\n` escapes into real linebreaks, which are not linebreaks in a path, and
 * would have resolved a `{{TEMPLATE:...}}` inclusion into the name.
 * `FileNameDisplayFormatter` is what `formatFileName` mirrors at run time, and
 * is what the builder's own file-name preview already uses.
 */
describe("one-page preflight previews the file name with the file-name formatter", () => {
	it("leaves a backslash-n in the name alone instead of splitting the path", async () => {
		await runOnePagePreflight(
			createApp(),
			createPlugin(),
			createExecutor(),
			createChoice(String.raw`Notes\name-{{VALUE:title}}`),
		);

		expect(computePreview).not.toBeNull();
		const out = await computePreview!({ title: "My Note" });
		expect(out.fileName).toBe(String.raw`Notes\name-My Note`);
		expect(out.fileName).not.toContain("\n");
	});

	it("does not pull a template's body into the file name", async () => {
		await runOnePagePreflight(
			createApp(),
			createPlugin(),
			createExecutor(),
			createChoice("{{TEMPLATE:Some.md}}-{{VALUE:title}}"),
		);

		const out = await computePreview!({ title: "My Note" });
		expect(out.fileName).toBe("{{TEMPLATE:Some.md}}-My Note");
	});
});
