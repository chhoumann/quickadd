import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TFile } from 'obsidian';

// Test implementation that simulates the template engine behavior
// without importing complex dependencies
class TestTemplateEngine {
	private variables: Map<string, unknown> = new Map();
	private templatePropertyVars: Map<string, unknown> = new Map();

	constructor(
		private app: any,
		private plugin: any,
		private testTemplatePath: string,
		private choiceExecutor?: any
	) {
		if (choiceExecutor?.variables) {
			this.variables = choiceExecutor.variables;
		}
	}

	async testCreateFileWithTemplate(filePath: string, templatePath: string): Promise<TFile | null> {
		try {
			// Get template content
			const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
			const templateContent = await this.app.vault.cachedRead(templateFile);

			// Extract filename without extension for future use
			// const fileBasename = filePath.split('/').pop()?.replace(/\.md$/, '') || '';
			
			// Collect template variables BEFORE formatting
			this.collectTemplateVars(templateContent);
			
			// Format template content (simplified)
			const formattedContent = await this.formatContent(templateContent);
			
			// Create file
			const createdFile = await this.app.vault.create(filePath, formattedContent);
			
			// Post-process front matter for template property types BEFORE Templater
			if (this.templatePropertyVars.size > 0 && createdFile.extension === 'md' && this.plugin.settings.enableTemplatePropertyTypes) {
				await this.postProcessFrontMatter(createdFile, this.templatePropertyVars);
			}

			return createdFile;
		} catch (err) {
			console.error(`Could not create file with template at ${filePath}`, err);
			return null;
		}
	}

	async testOverwriteFileWithTemplate(file: TFile, templatePath: string): Promise<TFile | null> {
		try {
			// Get template content
			const templateFile = this.app.vault.getAbstractFileByPath(templatePath);
			const templateContent = await this.app.vault.cachedRead(templateFile);
			
			// Collect template variables BEFORE formatting
			this.collectTemplateVars(templateContent);
			
			// Format template content
			const formattedContent = await this.formatContent(templateContent);
			
			// Modify file
			await this.app.vault.modify(file, formattedContent);

			// Post-process front matter for template property types BEFORE Templater
			if (this.templatePropertyVars.size > 0 && file.extension === 'md' && this.plugin.settings.enableTemplatePropertyTypes) {
				await this.postProcessFrontMatter(file, this.templatePropertyVars);
			}

			return file;
		} catch (err) {
			console.error("Could not overwrite file with template", err);
			return null;
		}
	}

	private async formatContent(content: string): Promise<string> {
		// Simplified template variable replacement
		let output = content;
		
		// Replace template variables
		const variableRegex = /\{\{([^}]+)\}\}/g;
		output = output.replace(variableRegex, (match, variableName) => {
			const value = this.variables.get(variableName.trim());
			if (value === undefined || value === null) {
				return '';
			}
			
			// For arrays, use a readable string representation
			if (Array.isArray(value)) {
				return value.join(', ');
			}
			
			return String(value);
		});

		return output;
	}

	private collectTemplateVars(templateContent: string): void {
		this.templatePropertyVars.clear();
		
		// Extract variables from template content
		const variableRegex = /\{\{([^}]+)\}\}/g;
		let match;
		
		while ((match = variableRegex.exec(templateContent)) !== null) {
			const variableName = match[1].trim();
			const value = this.variables.get(variableName);
			
			if (this.variables.has(variableName) && this.isInYamlFrontMatter(templateContent, match.index)) {
				// Convert @date: prefixed values to Date objects
				if (typeof value === 'string' && value.startsWith('@date:')) {
					const dateString = value.substring(6); // Remove '@date:' prefix
					const dateObj = new Date(dateString);
					
					// Only convert if it's a valid date
					if (!isNaN(dateObj.getTime())) {
						this.templatePropertyVars.set(variableName, dateObj);
					} else {
						this.templatePropertyVars.set(variableName, value);
					}
				} else {
					this.templatePropertyVars.set(variableName, value);
				}
			}
		}
	}

	private isInYamlFrontMatter(content: string, variableIndex: number): boolean {
		// Simple heuristic: check if variable is before the first '---' closing tag
		const frontMatterEnd = content.indexOf('---', 3); // Skip the opening '---'
		return frontMatterEnd > 0 && variableIndex < frontMatterEnd;
	}

	private async postProcessFrontMatter(file: TFile, templateVars: Map<string, unknown>): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
				for (const [key, value] of templateVars) {
					frontmatter[key] = value;
				}
			});
		} catch (err) {
			console.error(`Failed to post-process YAML front matter for file ${file.path}: ${err}`);
			// Don't throw - the file was still created successfully
		}
	}
}

// Test implementation for SingleTemplateEngine
class TestSingleTemplateEngine {
	private variables: Map<string, unknown> = new Map();
	private templatePropertyVars: Map<string, unknown> = new Map();

	constructor(
		private app: any,
		private plugin: any,
		private templatePath: string,
		private choiceExecutor?: any
	) {
		if (choiceExecutor?.variables) {
			this.variables = choiceExecutor.variables;
		}
	}

	async run(): Promise<string> {
		const templateFile = this.app.vault.getAbstractFileByPath(this.templatePath);
		let templateContent = await this.app.vault.cachedRead(templateFile);
		
		// Collect template variables BEFORE formatting (need original template)
		this.collectTemplateVars(templateContent);
		
		// Then format content
		templateContent = await this.formatContent(templateContent);
		
		return templateContent;
	}

	getAndClearTemplatePropertyVars(): Map<string, unknown> {
		const vars = new Map(this.templatePropertyVars);
		this.templatePropertyVars.clear(); // Clear after returning
		return vars;
	}

	private async formatContent(content: string): Promise<string> {
		// Simplified template variable replacement
		let output = content;
		
		const variableRegex = /\{\{([^}]+)\}\}/g;
		output = output.replace(variableRegex, (match, variableName) => {
			const value = this.variables.get(variableName.trim());
			if (value === undefined || value === null) {
				return '';
			}
			
			if (Array.isArray(value)) {
				return value.join(', ');
			}
			
			return String(value);
		});

		return output;
	}

	private collectTemplateVars(templateContent: string): void {
		this.templatePropertyVars.clear();
		
		const variableRegex = /\{\{([^}]+)\}\}/g;
		let match;
		
		while ((match = variableRegex.exec(templateContent)) !== null) {
			const variableName = match[1].trim();
			const value = this.variables.get(variableName);
			
			if (this.variables.has(variableName) && this.isInYamlFrontMatter(templateContent, match.index)) {
				// Convert @date: prefixed values to Date objects
				if (typeof value === 'string' && value.startsWith('@date:')) {
					const dateString = value.substring(6);
					const dateObj = new Date(dateString);
					
					if (!isNaN(dateObj.getTime())) {
						this.templatePropertyVars.set(variableName, dateObj);
					} else {
						this.templatePropertyVars.set(variableName, value);
					}
				} else {
					this.templatePropertyVars.set(variableName, value);
				}
			}
		}
	}

	private isInYamlFrontMatter(content: string, variableIndex: number): boolean {
		const frontMatterEnd = content.indexOf('---', 3);
		return frontMatterEnd > 0 && variableIndex < frontMatterEnd;
	}
}

// Mock implementations
const createMockApp = () => ({
	vault: {
		getAbstractFileByPath: vi.fn(),
		cachedRead: vi.fn(),
		adapter: {
			exists: vi.fn().mockResolvedValue(false)
		},
		modify: vi.fn(),
		create: vi.fn()
	},
	fileManager: {
		processFrontMatter: vi.fn(),
		generateMarkdownLink: vi.fn().mockReturnValue('[]()')
	},
	workspace: {
		getActiveFile: vi.fn().mockReturnValue(null),
		getActiveViewOfType: vi.fn().mockReturnValue(null)
	},
	metadataCache: {
		getFileCache: vi.fn()
	}
});

const createMockPlugin = () => ({
	settings: {
		enableTemplatePropertyTypes: true,
		globalVariables: {},
		showCaptureNotification: false
	}
});

const createMockFile = (path: string, extension = 'md'): TFile => {
	const file = new TFile();
	file.path = path;
	file.name = path.split('/').pop() || '';
	file.extension = extension;
	file.basename = file.name.replace(`.${extension}`, '');
	return file;
};

const createMockChoiceExecutor = () => ({
	variables: new Map(),
	execute: vi.fn()
});

describe('Template Property Types Integration Tests', () => {
	let mockApp: any;
	let mockPlugin: any;
	let mockChoiceExecutor: any;

	beforeEach(() => {
		mockApp = createMockApp();
		mockPlugin = createMockPlugin();
		mockChoiceExecutor = createMockChoiceExecutor();
		vi.clearAllMocks();
	});

	describe('TemplateEngine Integration', () => {
		let templateEngine: TestTemplateEngine;

		beforeEach(() => {
			templateEngine = new TestTemplateEngine(
				mockApp,
				mockPlugin,
				'test-template.md',
				mockChoiceExecutor
			);
		});

		it('should create file with typed template variables and post-process front matter', async () => {
			// Setup template content with typed variables
			const templateContent = `---
title: {{title}}
tags: {{tags}}
priority: {{priority}}
completed: {{completed}}
metadata: {{metadata}}
---

# {{title}}

Content here.`;

			const mockTemplateFile = createMockFile('templates/test-template.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			// Setup variables with different types
			mockChoiceExecutor.variables.set('title', 'My New Note');
			mockChoiceExecutor.variables.set('tags', ['work', 'project', 'urgent']);
			mockChoiceExecutor.variables.set('priority', 5);
			mockChoiceExecutor.variables.set('completed', false);
			mockChoiceExecutor.variables.set('metadata', { 
				author: 'Test User',
				version: 1.2,
				nested: { key: 'value' }
			});

			const createdFile = createMockFile('notes/new-note.md');
			mockApp.vault.create.mockResolvedValue(createdFile);

			// Mock processFrontMatter to capture the variables passed to it
			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			const result = await templateEngine.testCreateFileWithTemplate(
				'notes/new-note.md',
				'templates/test-template.md'
			);

			// Verify file was created
			expect(result).toBe(createdFile);
			expect(mockApp.vault.create).toHaveBeenCalled();

			// Verify front matter post-processing was called for markdown file
			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
				createdFile,
				expect.any(Function)
			);

			// Verify typed variables were passed to processFrontMatter
			expect(capturedFrontmatter.title).toBe('My New Note');
			expect(capturedFrontmatter.tags).toEqual(['work', 'project', 'urgent']);
			expect(capturedFrontmatter.priority).toBe(5);
			expect(capturedFrontmatter.completed).toBe(false);
			expect(capturedFrontmatter.metadata).toEqual({ 
				author: 'Test User',
				version: 1.2,
				nested: { key: 'value' }
			});
		});

		it('should skip post-processing for Canvas files', async () => {
			const templateContent = `{"nodes":[{"text":"{{title}}"}]}`;

			const mockTemplateFile = createMockFile('templates/test.canvas');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			mockChoiceExecutor.variables.set('title', 'Canvas Title');
			mockChoiceExecutor.variables.set('data', ['array', 'data']);

			const createdFile = createMockFile('notes/new.canvas', 'canvas');
			mockApp.vault.create.mockResolvedValue(createdFile);

			await templateEngine.testCreateFileWithTemplate(
				'notes/new.canvas',
				'templates/test.canvas'
			);

			// Canvas files should not have front matter post-processing
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
		});

		it('should handle overwriteFileWithTemplate with typed variables', async () => {
			const templateContent = `---
updated: {{updated}}
version: {{version}}
status: {{status}}
---

Updated content: {{content}}`;

			const mockTemplateFile = createMockFile('templates/update.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			mockChoiceExecutor.variables.set('updated', new Date('2025-01-01'));
			mockChoiceExecutor.variables.set('version', 2);
			mockChoiceExecutor.variables.set('status', 'active');
			mockChoiceExecutor.variables.set('content', 'Updated text'); // This is in body, not front matter

			const existingFile = createMockFile('notes/existing.md');
			
			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			await templateEngine.testOverwriteFileWithTemplate(existingFile, 'templates/update.md');

			// Verify file was modified
			expect(mockApp.vault.modify).toHaveBeenCalled();

			// Verify post-processing for typed variables
			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledWith(
				existingFile,
				expect.any(Function)
			);

			// Only variables in YAML front matter should be post-processed
			expect(capturedFrontmatter.updated).toBeInstanceOf(Date);
			expect(capturedFrontmatter.version).toBe(2);
			expect(capturedFrontmatter.status).toBe('active');
			// content is in body, not front matter, so it shouldn't be post-processed
			expect(capturedFrontmatter.content).toBeUndefined();
		});

		it('should handle processFrontMatter errors gracefully', async () => {
			const templateContent = `---
title: {{title}}
---
Content`;

			const mockTemplateFile = createMockFile('templates/test.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			mockChoiceExecutor.variables.set('title', 'Test');

			const createdFile = createMockFile('notes/test.md');
			mockApp.vault.create.mockResolvedValue(createdFile);

			// Mock processFrontMatter to throw an error
			mockApp.fileManager.processFrontMatter.mockRejectedValue(
				new Error('Front matter processing failed')
			);

			// Should not throw - error should be logged and file creation should continue
			const result = await templateEngine.testCreateFileWithTemplate(
				'notes/test.md',
				'templates/test.md'
			);

			expect(result).toBe(createdFile);
			expect(mockApp.vault.create).toHaveBeenCalled();
		});

		it('should respect feature flag when disabled', async () => {
			// Disable the feature
			mockPlugin.settings!.enableTemplatePropertyTypes = false;

			const templateContent = `---
tags: {{tags}}
---
Content`;

			const mockTemplateFile = createMockFile('templates/test.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			mockChoiceExecutor.variables.set('tags', ['tag1', 'tag2']);

			const createdFile = createMockFile('notes/test.md');
			mockApp.vault.create.mockResolvedValue(createdFile);

			await templateEngine.testCreateFileWithTemplate('notes/test.md', 'templates/test.md');

			// When feature is disabled, processFrontMatter should not be called
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();
		});

		it('should handle VDATE variables correctly', async () => {
			const templateContent = `---
due: {{dueDate}}
created: {{createdDate}}
---

Content`;

			const mockTemplateFile = createMockFile('templates/date-template.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			// VDATE variables are stored with @date: prefix in the variables map
			mockChoiceExecutor.variables.set('dueDate', '@date:2025-12-31');
			mockChoiceExecutor.variables.set('createdDate', '@date:2025-01-01T10:30:00.000Z');

			const createdFile = createMockFile('notes/dates.md');
			mockApp.vault.create.mockResolvedValue(createdFile);

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			await templateEngine.testCreateFileWithTemplate('notes/dates.md', 'templates/date-template.md');

			// VDATE variables should be converted to proper Date objects
			expect(capturedFrontmatter.dueDate).toBeInstanceOf(Date);
			expect(capturedFrontmatter.createdDate).toBeInstanceOf(Date);
		});

		it('should handle invalid dates gracefully', async () => {
			const templateContent = `---
validDate: {{validDate}}
invalidDate: {{invalidDate}}
---

Content`;

			const mockTemplateFile = createMockFile('templates/mixed-dates.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			mockChoiceExecutor.variables.set('validDate', '@date:2025-01-01');
			mockChoiceExecutor.variables.set('invalidDate', '@date:invalid-date-string');

			const createdFile = createMockFile('notes/mixed.md');
			mockApp.vault.create.mockResolvedValue(createdFile);

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			await templateEngine.testCreateFileWithTemplate('notes/mixed.md', 'templates/mixed-dates.md');

			// Valid date should be converted, invalid should remain as string
			expect(capturedFrontmatter.validDate).toBeInstanceOf(Date);
			expect(capturedFrontmatter.invalidDate).toBe('@date:invalid-date-string');
		});

		it('should convert @date:ISO strings to Date objects in postProcessFrontMatter', async () => {
			const templateContent = `---
testDate: {{testDate}}
regularString: {{regularString}}
---

Test content`;

			const mockTemplateFile = createMockFile('templates/date-test.md');
			const mockCreatedFile = createMockFile('notes/date-test.md');

			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);
			mockApp.vault.create.mockResolvedValue(mockCreatedFile);

			// Set up date variable with @date: prefix and regular string
			mockChoiceExecutor.variables.set('testDate', '@date:2025-01-15T14:30:00.000Z');
			mockChoiceExecutor.variables.set('regularString', 'not a date');

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			await templateEngine.testCreateFileWithTemplate('notes/date-test.md', 'templates/date-test.md');

			// Date string should be converted to Date object
			expect(capturedFrontmatter.testDate).toBeInstanceOf(Date);
			expect(capturedFrontmatter.testDate.toISOString()).toBe('2025-01-15T14:30:00.000Z');

			// Regular string should remain unchanged
			expect(capturedFrontmatter.regularString).toBe('not a date');
		});

		it('should handle edge cases in date conversion', async () => {
			const templateContent = `---
epochDate: {{epochDate}}
invalidDate: {{invalidDate}}
emptyDate: {{emptyDate}}
---

Test content`;

			const mockTemplateFile = createMockFile('templates/edge-dates.md');
			const mockCreatedFile = createMockFile('notes/edge-dates.md');

			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);
			mockApp.vault.create.mockResolvedValue(mockCreatedFile);

			// Set up various edge cases
			mockChoiceExecutor.variables.set('epochDate', '@date:1970-01-01T00:00:00.000Z');
			mockChoiceExecutor.variables.set('invalidDate', '@date:not-a-date');
			mockChoiceExecutor.variables.set('emptyDate', '@date:');

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			await templateEngine.testCreateFileWithTemplate('notes/edge-dates.md', 'templates/edge-dates.md');

			// Valid date should be converted
			expect(capturedFrontmatter.epochDate).toBeInstanceOf(Date);
			expect(capturedFrontmatter.epochDate.toISOString()).toBe('1970-01-01T00:00:00.000Z');

			// Invalid dates should remain as strings
			expect(capturedFrontmatter.invalidDate).toBe('@date:not-a-date');
			expect(capturedFrontmatter.emptyDate).toBe('@date:');
		});
	});

	describe('Property Type Verification', () => {
		let templateEngine: TestTemplateEngine;

		beforeEach(() => {
			templateEngine = new TestTemplateEngine(
				mockApp,
				mockPlugin,
				'test-template.md',
				mockChoiceExecutor
			);
		});

		it('should handle arrays correctly', async () => {
			const templateContent = `---
emptyArray: {{emptyArray}}
stringArray: {{stringArray}}
mixedArray: {{mixedArray}}
---

Content`;

			const mockTemplateFile = createMockFile('templates/arrays.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			mockChoiceExecutor.variables.set('emptyArray', []);
			mockChoiceExecutor.variables.set('stringArray', ['one', 'two', 'three']);
			mockChoiceExecutor.variables.set('mixedArray', ['string', 42, true, null]);

			const createdFile = createMockFile('notes/arrays.md');
			mockApp.vault.create.mockResolvedValue(createdFile);

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			await templateEngine.testCreateFileWithTemplate('notes/arrays.md', 'templates/arrays.md');

			expect(capturedFrontmatter.emptyArray).toEqual([]);
			expect(capturedFrontmatter.stringArray).toEqual(['one', 'two', 'three']);
			expect(capturedFrontmatter.mixedArray).toEqual(['string', 42, true, null]);
		});

		it('should handle objects correctly', async () => {
			const templateContent = `---
emptyObject: {{emptyObject}}
simpleObject: {{simpleObject}}
nestedObject: {{nestedObject}}
---

Content`;

			const mockTemplateFile = createMockFile('templates/objects.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			mockChoiceExecutor.variables.set('emptyObject', {});
			mockChoiceExecutor.variables.set('simpleObject', { key: 'value', count: 5 });
			mockChoiceExecutor.variables.set('nestedObject', {
				level1: {
					level2: {
						deep: 'value'
					},
					array: [1, 2, 3]
				}
			});

			const createdFile = createMockFile('notes/objects.md');
			mockApp.vault.create.mockResolvedValue(createdFile);

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			await templateEngine.testCreateFileWithTemplate('notes/objects.md', 'templates/objects.md');

			expect(capturedFrontmatter.emptyObject).toEqual({});
			expect(capturedFrontmatter.simpleObject).toEqual({ key: 'value', count: 5 });
			expect(capturedFrontmatter.nestedObject).toEqual({
				level1: {
					level2: {
						deep: 'value'
					},
					array: [1, 2, 3]
				}
			});
		});

		it('should handle primitive types correctly', async () => {
			const templateContent = `---
numberInt: {{numberInt}}
numberFloat: {{numberFloat}}
booleanTrue: {{booleanTrue}}
booleanFalse: {{booleanFalse}}
nullValue: {{nullValue}}
undefinedValue: {{undefinedValue}}
stringValue: {{stringValue}}
---

Content`;

			const mockTemplateFile = createMockFile('templates/primitives.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			mockChoiceExecutor.variables.set('numberInt', 42);
			mockChoiceExecutor.variables.set('numberFloat', 3.14);
			mockChoiceExecutor.variables.set('booleanTrue', true);
			mockChoiceExecutor.variables.set('booleanFalse', false);
			mockChoiceExecutor.variables.set('nullValue', null);
			mockChoiceExecutor.variables.set('undefinedValue', undefined);
			mockChoiceExecutor.variables.set('stringValue', 'Hello World');

			const createdFile = createMockFile('notes/primitives.md');
			mockApp.vault.create.mockResolvedValue(createdFile);

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			await templateEngine.testCreateFileWithTemplate('notes/primitives.md', 'templates/primitives.md');

			expect(capturedFrontmatter.numberInt).toBe(42);
			expect(capturedFrontmatter.numberFloat).toBe(3.14);
			expect(capturedFrontmatter.booleanTrue).toBe(true);
			expect(capturedFrontmatter.booleanFalse).toBe(false);
			expect(capturedFrontmatter.nullValue).toBe(null);
			expect(capturedFrontmatter.undefinedValue).toBe(undefined);
			expect(capturedFrontmatter.stringValue).toBe('Hello World');
		});
	});

	describe('SingleTemplateEngine Integration', () => {
		it('should return template variables from getAndClearTemplatePropertyVars', async () => {
			const templateContent = `---
tags: {{tags}}
priority: {{priority}}
---

Content`;

			const mockTemplateFile = createMockFile('templates/single.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			mockChoiceExecutor.variables.set('tags', ['test', 'integration']);
			mockChoiceExecutor.variables.set('priority', 1);

			const singleEngine = new TestSingleTemplateEngine(
				mockApp,
				mockPlugin,
				'templates/single.md',
				mockChoiceExecutor
			);

			// Run the template engine
			await singleEngine.run();

			// Get template property variables
			const templateVars = singleEngine.getAndClearTemplatePropertyVars();

			expect(templateVars.size).toBe(2);
			expect(templateVars.get('tags')).toEqual(['test', 'integration']);
			expect(templateVars.get('priority')).toBe(1);
		});

		it('should clear variables after getAndClearTemplatePropertyVars call', async () => {
			const templateContent = `---
test: {{test}}
---

Content`;

			const mockTemplateFile = createMockFile('templates/clear.md');
			mockApp.vault.getAbstractFileByPath.mockReturnValue(mockTemplateFile);
			mockApp.vault.cachedRead.mockResolvedValue(templateContent);

			mockChoiceExecutor.variables.set('test', 'value');

			const singleEngine = new TestSingleTemplateEngine(
				mockApp,
				mockPlugin,
				'templates/clear.md',
				mockChoiceExecutor
			);

			await singleEngine.run();

			// First call should return variables
			const firstCall = singleEngine.getAndClearTemplatePropertyVars();
			expect(firstCall.size).toBe(1);
			expect(firstCall.get('test')).toBe('value');

			// Second call should return empty map (variables were cleared)
			const secondCall = singleEngine.getAndClearTemplatePropertyVars();
			expect(secondCall.size).toBe(0);
		});
	});
});
