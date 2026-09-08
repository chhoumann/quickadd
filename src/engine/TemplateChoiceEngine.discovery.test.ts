import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	formatFileNameMock,
	formatFileContentMock,
	promptForTemplateNoteDiscoveryMock,
	openExistingFileTabMock,
	openFileMock,
	insertFileLinkMock,
	copyFileLinkMock,
	setTitleMock,
	setTargetFolderPathMock,
} = vi.hoisted(() => ({
	formatFileNameMock: vi.fn<(format: string, prompt: string) => Promise<string>>(),
	formatFileContentMock: vi.fn<() => Promise<string>>(),
	promptForTemplateNoteDiscoveryMock: vi.fn(),
	openExistingFileTabMock: vi.fn(),
	openFileMock: vi.fn(),
	insertFileLinkMock: vi.fn(),
	copyFileLinkMock: vi.fn(),
	setTitleMock: vi.fn(),
	setTargetFolderPathMock: vi.fn(),
}));

vi.mock("../formatters/completeFormatter", () => {
	class CompleteFormatterMock {
		setLinkToCurrentFileBehavior() {}
		setTitle(title: string) { setTitleMock(title); }
		setPromptRunContext() {}
		setTargetFolderPath(path: string) { setTargetFolderPathMock(path); }
		getAnonymousValue() { return undefined; }
		async withPromptScope<T>(_scope: string, _input: string, work: () => Promise<T>) {
			return await work();
		}
		async formatFileName(format: string, prompt: string) {
			return formatFileNameMock(format, prompt);
		}
		async formatFileContent() {
			return await formatFileContentMock();
		}
		async formatTemplateFilePath(input: string) {
			return input;
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

vi.mock("./promptForTemplateNoteDiscovery", async () => {
	const actual = await vi.importActual("./promptForTemplateNoteDiscovery");
	return {
		...(actual as Record<string, unknown>),
		promptForTemplateNoteDiscovery: promptForTemplateNoteDiscoveryMock,
	};
});

vi.mock("../utilityObsidian", () => ({
	getTemplater: vi.fn(() => ({})),
	overwriteTemplaterOnce: vi.fn(),
	getAllFolderPathsInVault: vi.fn(() => []),
	getTemplateFile: (app: App, path: string) => app.vault.getAbstractFileByPath(path),
	templaterParseTemplate: async (_app: App, content: string) => content,
	jumpToNextTemplaterCursorIfPossible: vi.fn(),
	insertFileLinkToActiveView: insertFileLinkMock,
	openExistingFileTab: openExistingFileTabMock,
	openFile: openFileMock,
}));

vi.mock("../utils/fileLinks", () => ({
	copyFileLinkToClipboard: copyFileLinkMock,
	getAppendLinkDestinationFile: () => null,
}));

vi.mock("../gui/GenericSuggester/genericSuggester", () => ({
	default: {
		Suggest: vi.fn(),
	},
}));

vi.mock("../main", () => ({
	default: class QuickAddMock {},
}));

vi.mock("obsidian-dataview", () => ({
	getAPI: vi.fn(),
}));

import { TFile, type App } from "obsidian";
import { TemplateChoiceEngine } from "./TemplateChoiceEngine";
import type ITemplateChoice from "../types/choices/ITemplateChoice";
import type { IChoiceExecutor } from "../IChoiceExecutor";
import { promptCancelled } from "../errors/UserCancelError";

function file(path: string): TFile {
	const tfile = new TFile();
	tfile.path = path;
	tfile.name = path.split("/").pop() ?? path;
	tfile.basename = tfile.name.replace(/\.(md|canvas|base)$/i, "");
	tfile.extension = tfile.name.split(".").pop() ?? "md";
	tfile.stat = { ctime: 0, mtime: 0, size: 0 };
	return tfile;
}

function choice(overrides: Partial<ITemplateChoice> = {}): ITemplateChoice {
	return {
		id: "template",
		name: "Project note",
		type: "Template",
		command: false,
		templatePath: "Templates/Project.md",
		folder: {
			enabled: false,
			folders: [],
			chooseWhenCreatingNote: false,
			createInSameFolderAsActiveFile: false,
			chooseFromSubfolders: false,
		},
		fileNameFormat: { enabled: false, format: "{{VALUE}}" },
		appendLink: false,
		copyLinkToClipboard: false,
		openFile: false,
		fileOpening: {
			location: "tab",
			direction: "vertical",
			mode: "source",
			focus: false,
		},
		fileExistsBehavior: { kind: "prompt" },
		discoverExistingNotesBeforeCreate: true,
		...overrides,
	};
}

function buildEngine(
	templateChoice = choice(),
	variables = new Map<string, unknown>(),
) {
	const created = file("Created.md");
	const template = file(templateChoice.templatePath);
	const files = new Map([[template.path, template]]);
	const contents = new Map([[template.path, "Template source"]]);
	const app = {
		workspace: {
			getActiveFile: vi.fn(() => null),
		},
		fileManager: {
			getNewFileParent: vi.fn(() => ({ path: "" })),
		},
		vault: {
			getRoot: vi.fn(() => ({ path: "" })),
			adapter: {
				exists: vi.fn(async () => false),
			},
			getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
			getFiles: vi.fn(() => [...files.values()]),
			cachedRead: vi.fn(async (target: TFile) => contents.get(target.path) ?? ""),
			createFolder: vi.fn(),
			create: vi.fn(async () => created),
			modify: vi.fn(async (target: TFile, content: string) => { contents.set(target.path, content); }),
			process: vi.fn(async (target: TFile, update: (content: string) => string) => {
				const content = update(contents.get(target.path) ?? "");
				contents.set(target.path, content);
				return content;
			}),
		},
	} as unknown as App;
	const choiceExecutor: IChoiceExecutor = {
		...createChoiceExecutor(),
		execute: vi.fn(),
		variables,
		recordExecutionResult: vi.fn(),
		signalAbort: vi.fn(),
		consumeAbortSignal: vi.fn(),
	};
	const plugin = { settings: { globalVariables: {} } } as never;
	const engine = new TemplateChoiceEngine(
		app,
		plugin,
		templateChoice,
		choiceExecutor,
	);
	return { engine, app, choiceExecutor, created, files, contents };
}

describe("TemplateChoiceEngine note discovery", () => {
	beforeEach(() => {
		formatFileNameMock.mockReset();
		formatFileNameMock.mockResolvedValue("Created");
		formatFileContentMock.mockReset();
		formatFileContentMock.mockResolvedValue("");
		promptForTemplateNoteDiscoveryMock.mockReset();
		openExistingFileTabMock.mockReset();
		openExistingFileTabMock.mockReturnValue(null);
		openFileMock.mockReset();
		insertFileLinkMock.mockReset();
		copyFileLinkMock.mockReset();
		setTitleMock.mockReset();
		setTargetFolderPathMock.mockReset();
	});

	it.each(["open", "appendBottom"] as const)("validates a missing append-link target only when the selected action needs it: %s", async (action) => {
		const context = buildEngine(choice({
			existingNoteAction: action,
			appendLink: { enabled: true, placement: "newLine", requireActiveFile: false, destination: { type: "specifiedFile", path: "Missing.md" } },
		}));
		const selected = file("Existing.md");
		promptForTemplateNoteDiscoveryMock.mockResolvedValue({ kind: "existing", file: selected });
		await context.engine.run();
		if (action === "open") {
			expect(openFileMock).toHaveBeenCalledWith(context.app, selected, expect.anything());
			expect(context.choiceExecutor.recordExecutionResult).toHaveBeenCalledWith({ status: "success", file: selected, effect: "unchanged" });
		} else {
			expect(openFileMock).not.toHaveBeenCalled();
			expect(context.choiceExecutor.recordExecutionResult).toHaveBeenCalledWith(expect.objectContaining({ status: "error", reason: expect.stringContaining("Append link target") }));
		}
		expect(formatFileContentMock).not.toHaveBeenCalled();
		expect(context.app.vault.modify).not.toHaveBeenCalled();
	});

	it.each(["Templates/Project.md", "/Templates/Project", "  /Templates/Project.md  "])
	("rejects the selected template source using the engine's path resolution: %s", async (templatePath) => {
		const context = buildEngine(choice({ templatePath, existingNoteAction: "overwrite" }));
		const source = file("Templates/Project.md");
		context.files.set(source.path, source);
		context.contents.set(source.path, "Reusable {{VALUE:owner}}");
		promptForTemplateNoteDiscoveryMock.mockResolvedValue({ kind: "existing", file: source });
		await context.engine.run();
		expect(context.choiceExecutor.signalAbort).toHaveBeenCalledWith(expect.objectContaining({
			message: expect.stringContaining("own template source"),
		}));
		expect(context.app.vault.modify).not.toHaveBeenCalled();
		expect(formatFileContentMock).not.toHaveBeenCalled();
		expect(context.contents.get(source.path)).toBe("Reusable {{VALUE:owner}}");
	});

	it("opens an existing discovery result unchanged and skips template side effects", async () => {
		const existing = file("People/Alice.md");
		promptForTemplateNoteDiscoveryMock.mockResolvedValue({
			kind: "existing",
			file: existing,
		});
		const { engine, app, choiceExecutor } = buildEngine(
			choice({
				appendLink: true,
				copyLinkToClipboard: true,
				fileExistsBehavior: { kind: "apply", mode: "overwrite" },
			}),
		);
		const createSpy = vi.spyOn(
			engine as unknown as {
				createFileWithTemplate: (path: string, template: string) => Promise<TFile | null>;
			},
			"createFileWithTemplate",
		);
		(app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValue(true);

		await engine.run();

		expect(formatFileNameMock).not.toHaveBeenCalled();
		expect(createSpy).not.toHaveBeenCalled();
		expect(insertFileLinkMock).not.toHaveBeenCalled();
		expect(copyFileLinkMock).not.toHaveBeenCalled();
		expect(openFileMock).toHaveBeenCalledWith(
			expect.anything(),
			existing,
			expect.objectContaining({ focus: true }),
		);
		expect(choiceExecutor.recordExecutionResult).toHaveBeenCalledWith({
			status: "success",
			file: existing,
			effect: "unchanged",
		});
	});

	it.each([
		["appendBottom", "---\nstatus: active\n---\nOriginal body\nUpdate"],
		["appendTop", "---\nstatus: active\n---\nUpdate\nOriginal body"],
		["overwrite", "Update"],
	] as const)("applies %s to the selected file without creating or rerouting a note", async (action, expected) => {
		const existing = file("People/Alice.md");
		promptForTemplateNoteDiscoveryMock.mockResolvedValue({ kind: "existing", file: existing });
		const { engine, app, choiceExecutor, files, contents } = buildEngine(choice({
			existingNoteAction: action,
			fileNameFormat: { enabled: true, format: "{{VALUE}}" },
			folder: { ...choice().folder, enabled: true, folders: ["Wrong/{{VALUE:folderOnly}}"] },
			fileExistsBehavior: { kind: "apply", mode: "duplicateSuffix" },
			appendLink: true,
			copyLinkToClipboard: true,
			openFile: true,
		}));
		files.set(existing.path, existing);
		contents.set(existing.path, "---\nstatus: active\n---\nOriginal body");
		formatFileContentMock.mockImplementation(async () => {
			expect(choiceExecutor.variables.get("value")).toBe("Alice");
			return "Update";
		});

		await engine.run();

		expect(contents.get(existing.path)).toBe(expected);
		expect(formatFileContentMock).toHaveBeenCalledTimes(1);
		expect(formatFileNameMock).not.toHaveBeenCalled();
		expect(app.vault.createFolder).not.toHaveBeenCalled();
		expect(app.vault.create).not.toHaveBeenCalled();
		expect(app.vault.adapter.exists).not.toHaveBeenCalled();
		expect(setTitleMock).toHaveBeenCalledWith("Alice");
		expect(setTargetFolderPathMock).toHaveBeenCalledWith("People");
		expect(choiceExecutor.variables.has("value")).toBe(false);
		expect(choiceExecutor.recordExecutionResult).toHaveBeenCalledExactlyOnceWith({
			status: "success", file: existing, effect: "changed",
		});
		expect(insertFileLinkMock).toHaveBeenCalledTimes(1);
		expect(copyFileLinkMock).toHaveBeenCalledExactlyOnceWith(existing);
		expect(openFileMock).toHaveBeenCalledWith(app, existing, expect.anything());
	});

	it.each(["appendBottom", "appendTop", "overwrite"] as const)("cancels %s before writing or running post-commit actions", async (action) => {
		const existing = file("People/Alice.md");
		promptForTemplateNoteDiscoveryMock.mockResolvedValue({ kind: "existing", file: existing });
		const { engine, app, choiceExecutor, files, contents } = buildEngine(choice({
			existingNoteAction: action, appendLink: true, copyLinkToClipboard: true, openFile: true,
		}));
		files.set(existing.path, existing);
		contents.set(existing.path, "Keep this body");
		const cancellation = promptCancelled();
		formatFileContentMock.mockRejectedValue(cancellation);

		await engine.run();

		expect(contents.get(existing.path)).toBe("Keep this body");
		expect(app.vault.modify).not.toHaveBeenCalled();
		expect(app.vault.process).not.toHaveBeenCalled();
		expect(app.vault.create).not.toHaveBeenCalled();
		expect(choiceExecutor.signalAbort).toHaveBeenCalledExactlyOnceWith(cancellation);
		expect(choiceExecutor.recordExecutionResult).not.toHaveBeenCalled();
		expect(choiceExecutor.variables.has("value")).toBe(false);
		expect(insertFileLinkMock).not.toHaveBeenCalled();
		expect(copyFileLinkMock).not.toHaveBeenCalled();
		expect(openFileMock).not.toHaveBeenCalled();
	});

	it.each(["appendBottom", "overwrite"] as const)("records a failed %s without post-commit actions", async (action) => {
		const existing = file("People/Alice.md");
		promptForTemplateNoteDiscoveryMock.mockResolvedValue({ kind: "existing", file: existing });
		const { engine, app, choiceExecutor, contents } = buildEngine(choice({
			existingNoteAction: action, appendLink: true, copyLinkToClipboard: true, openFile: true,
		}));
		contents.set(existing.path, "Keep this body");
		formatFileContentMock.mockResolvedValue("Update");
		vi.mocked(app.vault.modify).mockRejectedValue(new Error("Disk is read-only"));
		vi.mocked(app.vault.process).mockRejectedValue(new Error("Disk is read-only"));

		await engine.run();

		expect(contents.get(existing.path)).toBe("Keep this body");
		expect(choiceExecutor.recordExecutionResult).toHaveBeenCalledExactlyOnceWith({
			status: "error", reason: expect.stringContaining("Disk is read-only"),
		});
		expect(choiceExecutor.variables.has("value")).toBe(false);
		expect(insertFileLinkMock).not.toHaveBeenCalled();
		expect(copyFileLinkMock).not.toHaveBeenCalled();
		expect(openFileMock).not.toHaveBeenCalled();
	});

	it("seeds VALUE and continues through normal template creation for create rows", async () => {
		promptForTemplateNoteDiscoveryMock.mockResolvedValue({
			kind: "create",
			title: "Brand New Project",
		});
		const { engine, choiceExecutor, created } = buildEngine();
		formatFileNameMock.mockImplementation(async () => {
			expect(choiceExecutor.variables.get("value")).toBe("Brand New Project");
			return "Brand New Project";
		});
		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						path: string,
						template: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(created);

		await engine.run();

		expect(choiceExecutor.variables.has("value")).toBe(false);
		expect(formatFileNameMock).toHaveBeenCalledWith("{{value}}", "noteTitle");
		expect(createSpy).toHaveBeenCalledWith(
			"Brand New Project.md",
			"Templates/Project.md",
		);
	});

	it("honors foldered unresolved-link targets as vault-relative paths", async () => {
		promptForTemplateNoteDiscoveryMock.mockResolvedValue({
			kind: "create",
			title: "Projects/Missing Roadmap",
			vaultRelativePath: "Projects/Missing Roadmap",
		});
		const { engine, choiceExecutor, created } = buildEngine(
			choice({
				folder: {
					enabled: true,
					folders: ["Inbox"],
					chooseWhenCreatingNote: false,
					createInSameFolderAsActiveFile: false,
					chooseFromSubfolders: false,
				},
			}),
		);
		formatFileNameMock.mockImplementation(async () => {
			expect(choiceExecutor.variables.get("value")).toBe(
				"Projects/Missing Roadmap",
			);
			return "Projects/Missing Roadmap";
		});
		const createSpy = vi
			.spyOn(
				engine as unknown as {
					createFileWithTemplate: (
						path: string,
						template: string,
					) => Promise<TFile | null>;
				},
				"createFileWithTemplate",
			)
			.mockResolvedValue(created);

		await engine.run();

		expect(createSpy).toHaveBeenCalledWith(
			"Projects/Missing Roadmap.md",
			"Templates/Project.md",
		);
		expect(formatFileNameMock).not.toHaveBeenCalled();
		expect(choiceExecutor.variables.has("value")).toBe(false);
	});

	it("skips discovery when VALUE was already supplied by CLI, URI, or preflight", async () => {
		const { engine } = buildEngine(choice(), new Map([["value", "Seeded"]]));

		await engine.run();

		expect(promptForTemplateNoteDiscoveryMock).not.toHaveBeenCalled();
		expect(formatFileNameMock).toHaveBeenCalled();
	});

	it("requires explicit opt-in for persisted Template choices", async () => {
		const { engine } = buildEngine(
			choice({ discoverExistingNotesBeforeCreate: false }),
		);

		await engine.run();

		expect(promptForTemplateNoteDiscoveryMock).not.toHaveBeenCalled();
	});

	it("does not run for non-default file name formats", async () => {
		const { engine } = buildEngine(
			choice({
				fileNameFormat: { enabled: true, format: "Project {{VALUE}}" },
			}),
		);

		await engine.run();

		expect(promptForTemplateNoteDiscoveryMock).not.toHaveBeenCalled();
	});
});
