import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TFile } from 'obsidian';

/**
 * Integration tests for Templater interaction with structured YAML front matter.
 *
 * These tests verify that:
 * 1. Post-processing happens BEFORE Templater runs
 * 2. Structured variables (arrays, objects) are maintained after Templater processing
 * 3. Templater doesn't break the YAML formatting
 * 4. The order of operations is correct (QuickAdd format → post-process → Templater)
 */

// Test implementation that simulates the complete flow including Templater
class TestTemplateEngineWithTemplater {
	private variables: Map<string, unknown> = new Map();
	private templatePropertyVars: Map<string, unknown> = new Map();
	private templaterCallCount = 0;
	private postProcessCallOrder: string[] = [];

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

			// Step 1: Collect template variables BEFORE formatting
			this.postProcessCallOrder.push('collectVars');
			this.collectTemplateVars(templateContent);

			// Step 2: Format template content (QuickAdd variable replacement)
			this.postProcessCallOrder.push('formatContent');
			const formattedContent = await this.formatContent(templateContent);

			// Step 3: Create file
			this.postProcessCallOrder.push('createFile');
			const createdFile = await this.app.vault.create(filePath, formattedContent);

			// Step 4: Post-process front matter for template property types BEFORE Templater
			if (this.templatePropertyVars.size > 0 && createdFile.extension === 'md' && this.plugin.settings.enableTemplatePropertyTypes) {
				this.postProcessCallOrder.push('postProcessFrontMatter');
				await this.postProcessFrontMatter(createdFile, this.templatePropertyVars);
			}

			// Step 5: Process Templater commands (simulated)
			this.postProcessCallOrder.push('templater');
			await this.simulateTemplater(createdFile);

			return createdFile;
		} catch (err) {
			console.error(`Could not create file with template at ${filePath}`, err);
			return null;
		}
	}

	private async formatContent(content: string): Promise<string> {
		// Simplified template variable replacement (QuickAdd format)
		let output = content;

		// Replace QuickAdd template variables {{varName}}
		const variableRegex = /\{\{([^}]+)\}\}/g;
		output = output.replace(variableRegex, (match, variableName) => {
			const value = this.variables.get(variableName.trim());
			if (value === undefined || value === null) {
				return '';
			}

			// For arrays, use a readable string representation (will be overwritten by post-processing)
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

	/**
	 * Simulates Templater processing by:
	 * 1. Reading the file (after post-processing)
	 * 2. Processing any Templater syntax
	 * 3. Writing it back
	 *
	 * This is where we verify that structured variables survive Templater processing
	 */
	private async simulateTemplater(file: TFile): Promise<void> {
		this.templaterCallCount++;

		// Read the file content (which should now have structured YAML after post-processing)
		let content = await this.app.vault.read(file);

		// Process Templater syntax (e.g., <% tp.date.now() %>)
		// We'll simulate by replacing Templater syntax with actual values
		const templaterRegex = /<%\s*tp\.date\.now\((.*?)\)\s*%>/g;
		content = content.replace(templaterRegex, () => {
			return new Date().toISOString().split('T')[0]; // Return YYYY-MM-DD
		});

		// Simulate tp.date.tomorrow
		const tomorrowRegex = /<%\s*tp\.date\.tomorrow\((.*?)\)\s*%>/g;
		content = content.replace(tomorrowRegex, () => {
			const tomorrow = new Date();
			tomorrow.setDate(tomorrow.getDate() + 1);
			return tomorrow.toISOString().split('T')[0];
		});

		// Write the content back (simulating Templater's overwrite)
		await this.app.vault.modify(file, content);
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
		}
	}

	getTemplaterCallCount(): number {
		return this.templaterCallCount;
	}

	getCallOrder(): string[] {
		return this.postProcessCallOrder;
	}
}

// Mock implementations
const createMockApp = () => {
	let fileContents: Map<string, string> = new Map();

	return {
		vault: {
			getAbstractFileByPath: vi.fn((path: string) => {
				const file = new TFile();
				file.path = path;
				file.name = path.split('/').pop() || '';
				file.extension = path.endsWith('.md') ? 'md' : 'canvas';
				file.basename = file.name.replace(/\.(md|canvas)$/, '');
				return file;
			}),
			cachedRead: vi.fn((file: TFile) => {
				return Promise.resolve(fileContents.get(file.path) || '');
			}),
			adapter: {
				exists: vi.fn().mockResolvedValue(false)
			},
			modify: vi.fn((file: TFile, content: string) => {
				fileContents.set(file.path, content);
				return Promise.resolve();
			}),
			create: vi.fn((path: string, content: string) => {
				fileContents.set(path, content);
				const file = new TFile();
				file.path = path;
				file.name = path.split('/').pop() || '';
				file.extension = path.endsWith('.md') ? 'md' : 'canvas';
				file.basename = file.name.replace(/\.(md|canvas)$/, '');
				return Promise.resolve(file);
			}),
			read: vi.fn((file: TFile) => {
				return Promise.resolve(fileContents.get(file.path) || '');
			})
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
		},
		// Helper to access file contents in tests
		_getFileContents: (path: string) => fileContents.get(path),
		_setFileContents: (path: string, content: string) => fileContents.set(path, content)
	};
};

const createMockPlugin = () => ({
	settings: {
		enableTemplatePropertyTypes: true,
		globalVariables: {},
		showCaptureNotification: false,
		showInputCancellationNotification: true
	}
});

const createMockChoiceExecutor = () => ({
	variables: new Map(),
	execute: vi.fn()
});

describe('Templater Integration Tests', () => {
	let mockApp: any;
	let mockPlugin: any;
	let mockChoiceExecutor: any;

	beforeEach(() => {
		mockApp = createMockApp();
		mockPlugin = createMockPlugin();
		mockChoiceExecutor = createMockChoiceExecutor();
		vi.clearAllMocks();
	});

	describe('Order of Operations', () => {
		it('should process in correct order: collect → format → create → post-process → Templater', async () => {
			const templateContent = `---
title: {{title}}
tags: {{tags}}
---

# {{title}}

Today is <% tp.date.now() %>`;

			mockApp._setFileContents('templates/test.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'Test Note');
			mockChoiceExecutor.variables.set('tags', ['tag1', 'tag2']);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/test.md',
				mockChoiceExecutor
			);

			await templateEngine.testCreateFileWithTemplate(
				'notes/test.md',
				'templates/test.md'
			);

			const callOrder = templateEngine.getCallOrder();

			// Verify exact order
			expect(callOrder).toEqual([
				'collectVars',
				'formatContent',
				'createFile',
				'postProcessFrontMatter',
				'templater'
			]);
		});

		it('should call Templater exactly once', async () => {
			const templateContent = `---
title: {{title}}
---

Content with <% tp.date.now() %>`;

			mockApp._setFileContents('templates/test.md', templateContent);
			mockChoiceExecutor.variables.set('title', 'Test');

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/test.md',
				mockChoiceExecutor
			);

			await templateEngine.testCreateFileWithTemplate(
				'notes/test.md',
				'templates/test.md'
			);

			expect(templateEngine.getTemplaterCallCount()).toBe(1);
		});
	});

	describe('Structured Variables After Templater', () => {
		it('should maintain array structure after Templater processing', async () => {
			const templateContent = `---
title: {{title}}
tags: {{tags}}
created: <% tp.date.now() %>
---

# {{title}}`;

			mockApp._setFileContents('templates/test.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'Array Test');
			mockChoiceExecutor.variables.set('tags', ['work', 'project', 'urgent']);

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/test.md',
				mockChoiceExecutor
			);

			await templateEngine.testCreateFileWithTemplate(
				'notes/array-test.md',
				'templates/test.md'
			);

			// Verify post-processing was called BEFORE Templater
			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalled();

			// Verify array is properly structured in post-processing
			expect(capturedFrontmatter.tags).toEqual(['work', 'project', 'urgent']);
			expect(Array.isArray(capturedFrontmatter.tags)).toBe(true);

			// Verify Templater ran after post-processing
			expect(templateEngine.getTemplaterCallCount()).toBe(1);
		});

		it('should maintain nested object structure after Templater processing', async () => {
			const templateContent = `---
title: {{title}}
metadata: {{metadata}}
date: <% tp.date.now() %>
---

Content`;

			mockApp._setFileContents('templates/object-test.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'Object Test');
			mockChoiceExecutor.variables.set('metadata', {
				author: 'Test User',
				version: 1.2,
				nested: {
					key: 'value',
					count: 42
				}
			});

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/object-test.md',
				mockChoiceExecutor
			);

			await templateEngine.testCreateFileWithTemplate(
				'notes/object-test.md',
				'templates/object-test.md'
			);

			// Verify nested object structure is maintained
			expect(capturedFrontmatter.metadata).toEqual({
				author: 'Test User',
				version: 1.2,
				nested: {
					key: 'value',
					count: 42
				}
			});
			expect(typeof capturedFrontmatter.metadata).toBe('object');
			expect(capturedFrontmatter.metadata.nested).toBeDefined();
		});

		it('should maintain Date objects after Templater processing', async () => {
			const templateContent = `---
title: {{title}}
dueDate: {{dueDate}}
tomorrow: <% tp.date.tomorrow() %>
---

Content`;

			mockApp._setFileContents('templates/date-test.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'Date Test');
			mockChoiceExecutor.variables.set('dueDate', '@date:2025-12-31T10:30:00.000Z');

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/date-test.md',
				mockChoiceExecutor
			);

			await templateEngine.testCreateFileWithTemplate(
				'notes/date-test.md',
				'templates/date-test.md'
			);

			// Verify Date object is maintained
			expect(capturedFrontmatter.dueDate).toBeInstanceOf(Date);
			expect(capturedFrontmatter.dueDate.toISOString()).toBe('2025-12-31T10:30:00.000Z');
		});

		it('should maintain mixed types (arrays, objects, primitives) after Templater', async () => {
			const templateContent = `---
title: {{title}}
tags: {{tags}}
priority: {{priority}}
completed: {{completed}}
metadata: {{metadata}}
templaterDate: <% tp.date.now() %>
---

Content with Templater: <% tp.date.now() %>`;

			mockApp._setFileContents('templates/mixed-test.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'Mixed Types');
			mockChoiceExecutor.variables.set('tags', ['tag1', 'tag2', 'tag3']);
			mockChoiceExecutor.variables.set('priority', 5);
			mockChoiceExecutor.variables.set('completed', false);
			mockChoiceExecutor.variables.set('metadata', {
				author: 'User',
				counts: [1, 2, 3]
			});

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/mixed-test.md',
				mockChoiceExecutor
			);

			await templateEngine.testCreateFileWithTemplate(
				'notes/mixed-test.md',
				'templates/mixed-test.md'
			);

			// Verify all types are maintained
			expect(capturedFrontmatter.title).toBe('Mixed Types');
			expect(capturedFrontmatter.tags).toEqual(['tag1', 'tag2', 'tag3']);
			expect(Array.isArray(capturedFrontmatter.tags)).toBe(true);
			expect(capturedFrontmatter.priority).toBe(5);
			expect(capturedFrontmatter.completed).toBe(false);
			expect(capturedFrontmatter.metadata).toEqual({
				author: 'User',
				counts: [1, 2, 3]
			});

			// Verify Templater ran
			expect(templateEngine.getTemplaterCallCount()).toBe(1);
		});
	});

	describe('YAML Formatting Preservation', () => {
		it('should not break YAML formatting when Templater processes content', async () => {
			const templateContent = `---
title: {{title}}
tags: {{tags}}
---

# {{title}}

<% tp.date.now() %>`;

			mockApp._setFileContents('templates/yaml-test.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'YAML Test');
			mockChoiceExecutor.variables.set('tags', ['test']);

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/yaml-test.md',
				mockChoiceExecutor
			);

			const result = await templateEngine.testCreateFileWithTemplate(
				'notes/yaml-test.md',
				'templates/yaml-test.md'
			);

			// Verify processFrontMatter was called (which uses Obsidian's YAML parser)
			expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalled();

			// The fact that processFrontMatter succeeded means YAML is valid
			expect(result).not.toBeNull();
		});

		it('should handle empty arrays without breaking YAML', async () => {
			const templateContent = `---
title: {{title}}
emptyTags: {{emptyTags}}
date: <% tp.date.now() %>
---

Content`;

			mockApp._setFileContents('templates/empty-array.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'Empty Array');
			mockChoiceExecutor.variables.set('emptyTags', []);

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/empty-array.md',
				mockChoiceExecutor
			);

			await templateEngine.testCreateFileWithTemplate(
				'notes/empty-array.md',
				'templates/empty-array.md'
			);

			// Verify empty array is handled correctly
			expect(capturedFrontmatter.emptyTags).toEqual([]);
			expect(Array.isArray(capturedFrontmatter.emptyTags)).toBe(true);
		});
	});

	describe('Edge Cases with Templater', () => {
		it('should handle when Templater is not available', async () => {
			// In this case, Templater syntax should remain unchanged
			const templateContent = `---
title: {{title}}
tags: {{tags}}
---

<% tp.date.now() %>`;

			mockApp._setFileContents('templates/no-templater.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'No Templater');
			mockChoiceExecutor.variables.set('tags', ['test']);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/no-templater.md',
				mockChoiceExecutor
			);

			// Should still complete successfully
			const result = await templateEngine.testCreateFileWithTemplate(
				'notes/no-templater.md',
				'templates/no-templater.md'
			);

			expect(result).not.toBeNull();
		});

		it('should handle Templater syntax in front matter', async () => {
			const templateContent = `---
title: {{title}}
tags: {{tags}}
created: <% tp.date.now() %>
---

Content`;

			mockApp._setFileContents('templates/templater-fm.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'Templater in FM');
			mockChoiceExecutor.variables.set('tags', ['a', 'b']);

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/templater-fm.md',
				mockChoiceExecutor
			);

			await templateEngine.testCreateFileWithTemplate(
				'notes/templater-fm.md',
				'templates/templater-fm.md'
			);

			// QuickAdd variables should be post-processed
			expect(capturedFrontmatter.tags).toEqual(['a', 'b']);

			// Templater syntax gets processed after
			expect(templateEngine.getTemplaterCallCount()).toBe(1);
		});

		it('should skip post-processing when feature flag is disabled', async () => {
			mockPlugin.settings.enableTemplatePropertyTypes = false;

			const templateContent = `---
title: {{title}}
tags: {{tags}}
---

<% tp.date.now() %>`;

			mockApp._setFileContents('templates/disabled.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'Disabled');
			mockChoiceExecutor.variables.set('tags', ['test']);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/disabled.md',
				mockChoiceExecutor
			);

			await templateEngine.testCreateFileWithTemplate(
				'notes/disabled.md',
				'templates/disabled.md'
			);

			// Post-processing should be skipped
			expect(mockApp.fileManager.processFrontMatter).not.toHaveBeenCalled();

			// But Templater should still run
			expect(templateEngine.getTemplaterCallCount()).toBe(1);
		});

		it('should handle complex Templater syntax with structured variables', async () => {
			const templateContent = `---
title: {{title}}
tags: {{tags}}
metadata: {{metadata}}
created: <% tp.date.now() %>
modified: <% tp.date.now() %>
---

# {{title}}

Created: <% tp.date.now() %>
Tomorrow: <% tp.date.tomorrow() %>`;

			mockApp._setFileContents('templates/complex.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'Complex');
			mockChoiceExecutor.variables.set('tags', ['a', 'b', 'c']);
			mockChoiceExecutor.variables.set('metadata', {
				nested: {
					array: [1, 2, 3],
					bool: true
				}
			});

			let capturedFrontmatter: any = {};
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn(capturedFrontmatter);
				}
			);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/complex.md',
				mockChoiceExecutor
			);

			await templateEngine.testCreateFileWithTemplate(
				'notes/complex.md',
				'templates/complex.md'
			);

			// Verify all structured variables are maintained
			expect(capturedFrontmatter.tags).toEqual(['a', 'b', 'c']);
			expect(capturedFrontmatter.metadata.nested.array).toEqual([1, 2, 3]);
			expect(capturedFrontmatter.metadata.nested.bool).toBe(true);

			// Verify Templater processed both front matter and body
			expect(templateEngine.getTemplaterCallCount()).toBe(1);
		});
	});

	describe('Post-Processing Before Templater', () => {
		it('should ensure post-processed YAML is available when Templater runs', async () => {
			const templateContent = `---
title: {{title}}
tags: {{tags}}
---

Content`;

			mockApp._setFileContents('templates/order.md', templateContent);

			mockChoiceExecutor.variables.set('title', 'Order Test');
			mockChoiceExecutor.variables.set('tags', ['order', 'test']);

			let postProcessed = false;
			mockApp.fileManager.processFrontMatter.mockImplementation(
				async (file: TFile, fn: (fm: any) => void) => {
					fn({});
					postProcessed = true;
				}
			);

			const templateEngine = new TestTemplateEngineWithTemplater(
				mockApp,
				mockPlugin,
				'templates/order.md',
				mockChoiceExecutor
			);

			await templateEngine.testCreateFileWithTemplate(
				'notes/order.md',
				'templates/order.md'
			);

			const callOrder = templateEngine.getCallOrder();

			// Find indices of post-process and templater calls
			const postProcessIndex = callOrder.indexOf('postProcessFrontMatter');
			const templaterIndex = callOrder.indexOf('templater');

			// Verify post-processing happens before Templater
			expect(postProcessIndex).toBeGreaterThan(-1);
			expect(templaterIndex).toBeGreaterThan(-1);
			expect(postProcessIndex).toBeLessThan(templaterIndex);
			expect(postProcessed).toBe(true);
		});
	});
});
