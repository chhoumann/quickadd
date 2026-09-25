import { describe, it, expect, vi } from 'vitest';
import { MARKDOWN_FILE_EXTENSION_REGEX as MARKDOWN_REGEX,
	CANVAS_FILE_EXTENSION_REGEX as CANVAS_REGEX,
	BASE_FILE_EXTENSION_REGEX as BASE_REGEX } from "../constants";
import { hasTemplateExtension } from "../utils/templateFolderUtils";
import { templateHarness } from "../../tests/helpers/engines/templateHarness";
import { TemplateChoice } from "../types/choices/TemplateChoice";
import { TemplateChoiceEngine } from "./TemplateChoiceEngine";

vi.mock("../main", () => ({ default: class {} }));
vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));

describe('Canvas Template Integration', () => {
	describe('Regex patterns for canvas support', () => {
		it('should correctly identify markdown files', () => {
			expect(MARKDOWN_REGEX.test('file.md')).toBe(true);
			expect(MARKDOWN_REGEX.test('path/to/file.md')).toBe(true);
			expect(MARKDOWN_REGEX.test('file.canvas')).toBe(false);
			expect(MARKDOWN_REGEX.test('file.txt')).toBe(false);
		});

		it('should correctly identify canvas files', () => {
			expect(CANVAS_REGEX.test('file.canvas')).toBe(true);
			expect(CANVAS_REGEX.test('path/to/file.canvas')).toBe(true);
			expect(CANVAS_REGEX.test('file.md')).toBe(false);
			expect(CANVAS_REGEX.test('file.txt')).toBe(false);
		});

		it('should have mutually exclusive patterns', () => {
			const testFiles = ['file.md', 'file.canvas', 'file.base', 'file.txt', 'file'];

			testFiles.forEach(file => {
				const matchesMd = MARKDOWN_REGEX.test(file);
				const matchesCanvas = CANVAS_REGEX.test(file);
				const matchesBase = BASE_REGEX.test(file);
				expect(matchesMd && matchesCanvas).toBe(false);
				expect(matchesMd && matchesBase).toBe(false);
				expect(matchesCanvas && matchesBase).toBe(false);
			});
		});
	});

	describe('Template extension logic', () => {
		const getTemplateExtension = (path: string) => templateHarness().engine.extension(path);

		it('should return .canvas for canvas templates', () => {
			expect(getTemplateExtension('template.canvas')).toBe('.canvas');
			expect(getTemplateExtension('path/to/template.canvas')).toBe('.canvas');
		});

		it('should return .md for other templates', () => {
			expect(getTemplateExtension('template.md')).toBe('.md');
			expect(getTemplateExtension('template')).toBe('.md');
			expect(getTemplateExtension('template.txt')).toBe('.md');
		});

		it('should return .base for base templates', () => {
			expect(getTemplateExtension('template.base')).toBe('.base');
			expect(getTemplateExtension('path/to/template.base')).toBe('.base');
		});
	});

	describe('File path normalization', () => {
		const normalizeTemplateFilePath = (folder: string, name: string, template: string) =>
			templateHarness().engine.normalizePath(folder, name, template);

		it('should create canvas paths for canvas templates', () => {
			expect(normalizeTemplateFilePath('Templates', 'MyFile', 'template.canvas'))
				.toBe('Templates/MyFile.canvas');
		});

		it('should create markdown paths for markdown templates', () => {
			expect(normalizeTemplateFilePath('Templates', 'MyFile', 'template.md'))
				.toBe('Templates/MyFile.md');
		});

		it('should handle empty folder paths', () => {
			expect(normalizeTemplateFilePath('', 'MyFile', 'template.canvas'))
				.toBe('MyFile.canvas');
		});

		it('should strip existing extensions', () => {
			expect(normalizeTemplateFilePath('', 'MyFile.md', 'template.canvas'))
				.toBe('MyFile.canvas');
		});

		it('should strip leading slashes from folder and file names', () => {
			expect(normalizeTemplateFilePath('/Templates', '/MyFile', 'template.md'))
				.toBe('Templates/MyFile.md');
		});

		it('should create base paths for base templates', () => {
			expect(normalizeTemplateFilePath('Templates', 'Board', 'template.base'))
				.toBe('Templates/Board.base');
		});
	});

	describe('Template path processing logic', () => {
		const shouldAppendMdExtension = (path: string) => !hasTemplateExtension(path);

		it('should not append .md to recognized extensions', () => {
			expect(shouldAppendMdExtension('template.canvas')).toBe(false);
			expect(shouldAppendMdExtension('template.md')).toBe(false);
			expect(shouldAppendMdExtension('template.base')).toBe(false);
		});

		it('should append .md to unrecognized paths', () => {
			expect(shouldAppendMdExtension('template')).toBe(true);
			expect(shouldAppendMdExtension('template.txt')).toBe(true);
		});
	});

	describe('File validation through template overwrite', () => {
		async function overwrite(extension: string) {
			const h = templateHarness();
			h.file("template.md", "Replacement");
			const file = h.file("note.md", "Original");
			file.extension = extension;
			const choice = new TemplateChoice("File validation");
			choice.templatePath = "template.md";
			choice.fileNameFormat = { enabled: true, format: "note" };
			choice.folder.enabled = true;
			choice.folder.folders = [""];
			choice.fileExistsBehavior = { kind: "apply", mode: "overwrite" };
			await new TemplateChoiceEngine(h.app, h.plugin, choice, h.executor).run();
			return h;
		}

		it('should accept markdown and canvas files', async () => {
			for (const extension of ["md", "canvas", "base"]) {
				const h = await overwrite(extension);
				expect(h.vault.process, extension).toHaveBeenCalled();
				expect(h.contents.get("note.md"), extension).toBe("Replacement");
			}
		});

		it('should reject other file types', async () => {
			for (const extension of ["txt", "js"]) {
				const h = await overwrite(extension);
				expect(h.vault.process, extension).not.toHaveBeenCalled();
				expect(h.contents.get("note.md"), extension).toBe("Original");
			}
		});
	});
});
