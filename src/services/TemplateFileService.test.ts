import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import { TFile, TFolder } from "obsidian";
import type { TemplateEvaluator } from "./TemplateFileService";
import { TemplateFileService } from "./TemplateFileService";

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
});
