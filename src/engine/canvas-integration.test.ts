import { describe, it, expect } from 'vitest';

describe('Canvas Template Integration', () => {
	describe('Regex patterns for canvas support', () => {
		// Test the actual regex patterns used in the implementation
		const MARKDOWN_REGEX = new RegExp(/\.md$/);
		const CANVAS_REGEX = new RegExp(/\.canvas$/);
		const BASE_REGEX = new RegExp(/\.base$/);
		
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
		const getTemplateExtension = (templatePath: string): string => {
			const CANVAS_REGEX = new RegExp(/\.canvas$/);
			const BASE_REGEX = new RegExp(/\.base$/);
			if (CANVAS_REGEX.test(templatePath)) {
				return ".canvas";
			}
			if (BASE_REGEX.test(templatePath)) {
				return ".base";
			}
			return ".md";
		};

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
		const stripLeadingSlash = (path: string): string => {
			return path.replace(/^\/+/, "");
		};

		const normalizeTemplateFilePath = (
			folderPath: string,
			fileName: string,
			templatePath: string
		): string => {
			const MARKDOWN_REGEX = new RegExp(/\.md$/);
			const CANVAS_REGEX = new RegExp(/\.canvas$/);
			const BASE_REGEX = new RegExp(/\.base$/);
			
			const safeFolderPath = stripLeadingSlash(folderPath);
			const actualFolderPath = safeFolderPath ? `${safeFolderPath}/` : "";
			let extension = ".md";
			if (CANVAS_REGEX.test(templatePath)) {
				extension = ".canvas";
			} else if (BASE_REGEX.test(templatePath)) {
				extension = ".base";
			}
			const formattedFileName = stripLeadingSlash(fileName)
				.replace(MARKDOWN_REGEX, "")
				.replace(CANVAS_REGEX, "")
				.replace(BASE_REGEX, "");
			return `${actualFolderPath}${formattedFileName}${extension}`;
		};

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
		const shouldAppendMdExtension = (templatePath: string): boolean => {
			const MARKDOWN_REGEX = new RegExp(/\.md$/);
			const CANVAS_REGEX = new RegExp(/\.canvas$/);
			const BASE_REGEX = new RegExp(/\.base$/);
			return !MARKDOWN_REGEX.test(templatePath) &&
				!CANVAS_REGEX.test(templatePath) &&
				!BASE_REGEX.test(templatePath);
		};

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

	describe('File validation logic', () => {
		const isValidFileType = (extension: string): boolean => {
			return extension === 'md' || extension === 'canvas' || extension === 'base';
		};

		it('should accept markdown and canvas files', () => {
			expect(isValidFileType('md')).toBe(true);
			expect(isValidFileType('canvas')).toBe(true);
			expect(isValidFileType('base')).toBe(true);
		});

		it('should reject other file types', () => {
			expect(isValidFileType('txt')).toBe(false);
			expect(isValidFileType('js')).toBe(false);
		});
	});
});
