import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import type { TemplateEvaluator } from "./TemplateFileService";
import { TemplateFileService } from "./TemplateFileService";
import { templaterParseTemplate } from "../utilityObsidian";

vi.mock("../utilityObsidian", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return {
		...actual,
		overwriteTemplaterOnce: vi.fn(async () => undefined),
		templaterParseTemplate: vi.fn(async (_app, content: string) => content),
		withTemplaterFileCreationSuppressed: vi.fn(
			async (_app, _path, createFile: () => Promise<TFile>) => createFile(),
		),
	};
});

function file(path: string, extension = path.split(".").pop() ?? "md"): TFile {
	const result = new TFile();
	result.path = path;
	result.name = path.split("/").pop() ?? path;
	result.basename = result.name.replace(/\.[^.]+$/, "");
	result.extension = extension;
	return result;
}

function folder(path: string): TFolder {
	const result = new TFolder();
	result.path = path;
	return result;
}

describe("TemplateFileService", () => {
	let app: App;
	let abstractFiles: Map<string, TFile | TFolder>;
	let service: TemplateFileService;

	beforeEach(() => {
		abstractFiles = new Map();
		app = {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => abstractFiles.get(path)),
				cachedRead: vi.fn(async (template: TFile) => `content:${template.path}`),
				adapter: { exists: vi.fn(async () => false) },
				createFolder: vi.fn(),
				create: vi.fn(async (path: string) => file(path)),
				modify: vi.fn(),
			},
			fileManager: {
				processFrontMatter: vi.fn(),
			},
		} as unknown as App;
		service = new TemplateFileService(app);
		vi.mocked(templaterParseTemplate).mockClear();
		vi.mocked(templaterParseTemplate).mockImplementation(
			async (_app, content: string) => content,
		);
	});

	it("normalizes and reads only concrete template files", async () => {
		abstractFiles.set("Templates/Daily.md", file("Templates/Daily.md"));
		abstractFiles.set("Templates/Folder.md", folder("Templates/Folder.md"));

		expect(service.normalizeTemplatePath("/Templates/Daily")).toBe(
			"Templates/Daily.md",
		);
		await expect(
			service.readTemplateContent("/Templates/Daily"),
		).resolves.toBe("content:Templates/Daily.md");
		expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(
			"Templates/Daily.md",
		);

		expect(() => service.getTemplateFile("Templates/Missing")).toThrow(
			'Template file not found at path "Templates/Missing.md".',
		);
		expect(() => service.getTemplateFile("Templates/Folder")).toThrow(
			'Template file not found at path "Templates/Folder.md".',
		);
	});

	it("derives target paths from template extensions", () => {
		expect(
			service.normalizeTemplateFilePath("/Notes", "/Daily.md", "T.md"),
		).toBe("Notes/Daily.md");
		expect(
			service.normalizeTemplateFilePath("Canvases", "Board.md", "T.canvas"),
		).toBe("Canvases/Board.canvas");
		expect(
			service.normalizeTemplateFilePath("", "Data.canvas", "T.base"),
		).toBe("Data.base");
	});

	it("creates files using evaluated content and returned property variables", async () => {
		const template = file("Templates/Daily.md");
		abstractFiles.set("Templates/Daily.md", template);
		const vars = new Map<string, unknown>([["aliases", ["a"]]]);
		const evaluator = {
			evaluateTemplateContent: vi.fn(async () => ({
				content: "---\naliases: {{VALUE:aliases}}\n---\n",
				templatePropertyVars: vars,
			})),
		} as unknown as TemplateEvaluator;

		const created = await service.createFileWithTemplate(
			"Notes/Daily.md",
			"Templates/Daily",
			evaluator,
		);

		expect(created).toBeInstanceOf(TFile);
		expect(evaluator.evaluateTemplateContent).toHaveBeenCalledWith(
			"content:Templates/Daily.md",
			"Notes/Daily.md",
		);
		expect(app.vault.create).toHaveBeenCalledWith(
			"Notes/Daily.md",
			"---\naliases: {{VALUE:aliases}}\n---\n",
		);
		expect(app.fileManager.processFrontMatter).toHaveBeenCalledWith(
			created,
			expect.any(Function),
		);
	});

	it("appends template content without collecting template property variables", async () => {
		const existingFile = file("Notes/Daily.md");
		(app.vault.cachedRead as ReturnType<typeof vi.fn>).mockResolvedValue(
			"existing",
		);
		const evaluator = {
			evaluateTemplateContent: vi.fn(),
			evaluateTemplateContentForAppend: vi.fn(async () => "---\naliases: a, b\n---"),
		} as unknown as TemplateEvaluator;

		const appended = await service.appendToFileWithTemplateContent(
			existingFile,
			"---\naliases: {{VALUE:aliases}}\n---",
			"bottom",
			evaluator,
		);

		expect(appended).toBe(existingFile);
		expect(evaluator.evaluateTemplateContentForAppend).toHaveBeenCalledWith(
			"---\naliases: {{VALUE:aliases}}\n---",
			"Notes/Daily.md",
		);
		expect(evaluator.evaluateTemplateContent).not.toHaveBeenCalled();
		expect(app.vault.modify).toHaveBeenCalledWith(
			existingFile,
			"existing\n---\naliases: a, b\n---",
		);
		expect(app.fileManager.processFrontMatter).not.toHaveBeenCalled();
	});

	it("parses markdown append content with Templater before modifying the file", async () => {
		const existingFile = file("Notes/Daily.md");
		(app.vault.cachedRead as ReturnType<typeof vi.fn>).mockResolvedValue(
			"existing",
		);
		vi.mocked(templaterParseTemplate).mockResolvedValue("parsed");
		const evaluator = {
			evaluateTemplateContentForAppend: vi.fn(async () => "raw templater"),
		} as unknown as TemplateEvaluator;

		await service.appendToFileWithTemplateContent(
			existingFile,
			"template",
			"top",
			evaluator,
		);

		expect(templaterParseTemplate).toHaveBeenCalledTimes(1);
		expect(templaterParseTemplate).toHaveBeenCalledWith(
			app,
			"raw templater",
			existingFile,
		);
		expect(
			vi.mocked(templaterParseTemplate).mock.invocationCallOrder[0],
		).toBeLessThan(
			(app.vault.cachedRead as ReturnType<typeof vi.fn>).mock
				.invocationCallOrder[0],
		);
		expect(app.vault.modify).toHaveBeenCalledWith(
			existingFile,
			"parsed\nexisting",
		);
	});

	it("leaves existing files unchanged when markdown append Templater parsing fails", async () => {
		const existingFile = file("Notes/Daily.md");
		vi.mocked(templaterParseTemplate).mockRejectedValue(new Error("boom"));
		const evaluator = {
			evaluateTemplateContentForAppend: vi.fn(async () => "raw templater"),
		} as unknown as TemplateEvaluator;

		const appended = await service.appendToFileWithTemplateContent(
			existingFile,
			"template",
			"bottom",
			evaluator,
		);

		expect(appended).toBeNull();
		expect(app.vault.cachedRead).not.toHaveBeenCalled();
		expect(app.vault.modify).not.toHaveBeenCalled();
	});

	it("skips Templater when appending to canvas and base files", async () => {
		const canvasFile = file("Boards/Board.canvas", "canvas");
		const baseFile = file("Bases/Data.base", "base");
		(app.vault.cachedRead as ReturnType<typeof vi.fn>)
			.mockResolvedValueOnce("canvas existing")
			.mockResolvedValueOnce("base existing");
		const evaluator = {
			evaluateTemplateContentForAppend: vi.fn(async () => "content"),
		} as unknown as TemplateEvaluator;

		await service.appendToFileWithTemplateContent(
			canvasFile,
			"template",
			"bottom",
			evaluator,
		);
		await service.appendToFileWithTemplateContent(
			baseFile,
			"template",
			"top",
			evaluator,
		);

		expect(templaterParseTemplate).not.toHaveBeenCalled();
		expect(app.vault.modify).toHaveBeenNthCalledWith(
			1,
			canvasFile,
			"canvas existing\ncontent",
		);
		expect(app.vault.modify).toHaveBeenNthCalledWith(
			2,
			baseFile,
			"content\nbase existing",
		);
	});
});
