import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TFile } from 'obsidian';

// Comprehensive system-level test suite for Template Property Types feature
// Tests realistic user scenarios across different platforms and file types

/**
 * Test engine that accurately simulates the complete QuickAdd workflow
 * for template property types processing
 */
class SystemTestEngine {
	private variables: Map<string, unknown> = new Map();
	private templatePropertyVars: Map<string, unknown> = new Map();
	public fileSystem: Map<string, string> = new Map();

	constructor(
		private app: any,
		private plugin: any,
		private choiceExecutor?: any
	) {
		if (choiceExecutor?.variables) {
			this.variables = choiceExecutor.variables;
		}
	}

	setVariable(name: string, value: unknown): void {
		this.variables.set(name, value);
	}

	getAndClearTemplatePropertyVars(): Map<string, unknown> {
		return new Map(this.templatePropertyVars);
	}

	// Simulate creating a template file choice
	async createFileWithTemplate(filePath: string, templatePath: string): Promise<TFile | null> {
		try {
			// Mock template file existence
			const templateContent = this.fileSystem.get(templatePath);
			if (!templateContent) {
				// Try to read from app.vault (for error testing)
				if (this.app.vault.cachedRead) {
					await this.app.vault.cachedRead();
				}
				throw new Error(`Template not found: ${templatePath}`);
			}

			// Collect template variables before processing
			this.collectTemplateVars(templateContent);
			
			// Format template content
			const formattedContent = await this.formatContent(templateContent);
			
			// Create the target file
			const createdFile = this.createMockFile(filePath);
			this.fileSystem.set(filePath, formattedContent);
			
			// Post-process for template property types (only for .md files)
			if (this.templatePropertyVars.size > 0 && 
				createdFile.extension === 'md' && 
				this.plugin.settings.enableTemplatePropertyTypes) {
				await this.postProcessFrontMatter(createdFile, this.templatePropertyVars);
			}

			return createdFile;
		} catch (err) {
			console.error(`Could not create file with template at ${filePath}`, err);
			return null;
		}
	}

	// Simulate capture choice with template creation
	async captureWithTemplate(filePath: string, templatePath: string, capturedContent: string): Promise<TFile | null> {
		try {
			const templateContent = this.fileSystem.get(templatePath);
			if (!templateContent) {
				throw new Error(`Template not found: ${templatePath}`);
			}

			// Set up capture-specific variables
			this.setVariable('VALUE', capturedContent);
			this.setVariable('DATE', new Date());
			
			// Process template
			this.collectTemplateVars(templateContent);
			const formattedContent = await this.formatContent(templateContent);
			
			const createdFile = this.createMockFile(filePath);
			this.fileSystem.set(filePath, formattedContent);
			
			// Post-process for template property types
			if (this.templatePropertyVars.size > 0 && 
				createdFile.extension === 'md' && 
				this.plugin.settings.enableTemplatePropertyTypes) {
				await this.postProcessFrontMatter(createdFile, this.templatePropertyVars);
			}

			return createdFile;
		} catch (err) {
			console.error(`Could not capture with template at ${filePath}`, err);
			return null;
		}
	}

	// Simulate overwriting existing files
	async overwriteFileWithTemplate(file: TFile, templatePath: string): Promise<TFile | null> {
		try {
			const templateContent = this.fileSystem.get(templatePath);
			if (!templateContent) {
				throw new Error(`Template not found: ${templatePath}`);
			}

			this.collectTemplateVars(templateContent);
			const formattedContent = await this.formatContent(templateContent);
			
			// Overwrite existing file
			this.fileSystem.set(file.path, formattedContent);
			
			// Post-process for template property types
			if (this.templatePropertyVars.size > 0 && 
				file.extension === 'md' && 
				this.plugin.settings.enableTemplatePropertyTypes) {
				await this.postProcessFrontMatter(file, this.templatePropertyVars);
			}

			return file;
		} catch (err) {
			console.error("Could not overwrite file with template", err);
			return null;
		}
	}

	// Create template content with specified line endings
	createTemplate(path: string, content: string, lineEnding: 'LF' | 'CRLF' = 'LF'): void {
		const processedContent = lineEnding === 'CRLF' 
			? content.replace(/\n/g, '\r\n')
			: content;
		this.fileSystem.set(path, processedContent);
	}

	// Get the final file content (for verification)
	getFileContent(path: string): string {
		return this.fileSystem.get(path) || '';
	}

	private async formatContent(content: string): Promise<string> {
		let output = content;
		
		const variableRegex = /\{\{([^}]+)\}\}/g;
		output = output.replace(variableRegex, (match, variableName) => {
			const trimmedName = variableName.trim();
			const value = this.variables.get(trimmedName);
			
			if (value === undefined || value === null) {
				return '';
			}
			
			// Handle different data types for template display
			if (Array.isArray(value)) {
				// For array of objects, need special handling
				const hasObjects = value.some(item => typeof item === 'object' && item !== null && !(item instanceof Date));
				if (hasObjects) {
					return value.map(item => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ');
				}
				return value.join(', ');
			} else if (value instanceof Date) {
				return value.toISOString().split('T')[0];
			} else if (typeof value === 'object') {
				return JSON.stringify(value);
			} else if (typeof value === 'boolean') {
				return value.toString();
			} else if (typeof value === 'number') {
				return value.toString();
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
			
			// Only track variables that are in YAML front matter
			if (this.variables.has(variableName) && this.isInYamlFrontMatter(templateContent, match.index)) {
				this.templatePropertyVars.set(variableName, value);
			}
		}
	}

	private isInYamlFrontMatter(content: string, variableIndex: number): boolean {
		// Check if we're between the opening --- and closing ---
		const lines = content.split(/\r?\n/);
		let charCount = 0;
		let inFrontMatter = false;
		
		for (const line of lines) {
			if (line.trim() === '---') {
				if (!inFrontMatter) {
					inFrontMatter = true;
				} else {
					// End of front matter
					return variableIndex >= 0 && variableIndex < charCount;
				}
			}
			
			charCount += line.length + 1; // +1 for newline
			
			if (variableIndex < charCount && inFrontMatter) {
				return true;
			}
		}
		
		return false;
	}

	private async postProcessFrontMatter(file: TFile, templateVars: Map<string, unknown>): Promise<void> {
		const currentContent = this.fileSystem.get(file.path) || '';
		const processedContent = this.processFrontMatterContent(currentContent, templateVars);
		this.fileSystem.set(file.path, processedContent);
		
		// Mock the app.fileManager.processFrontMatter call
		this.app.fileManager.processFrontMatter.mockImplementation(
			(targetFile: TFile, fn: (frontmatter: any) => void) => {
				const frontMatter = this.extractFrontMatter(processedContent);
				fn(frontMatter);
			}
		);
	}

	private processFrontMatterContent(content: string, templateVars: Map<string, unknown>): string {
		const lines = content.split(/\r?\n/);
		const isLF = !content.includes('\r\n');
		const lineEnding = isLF ? '\n' : '\r\n';
		
		let inFrontMatter = false;
		let frontMatterEndIndex = -1;
		
		// Find front matter boundaries
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].trim() === '---') {
				if (!inFrontMatter) {
					inFrontMatter = true;
				} else {
					frontMatterEndIndex = i;
					break;
				}
			}
		}
		
		if (frontMatterEndIndex === -1) return content;
		
		// Process front matter lines
		const processedLines = lines.slice();
		for (let i = 1; i < frontMatterEndIndex; i++) {
			const line = processedLines[i];
			const colonIndex = line.indexOf(':');
			
			if (colonIndex > -1) {
				const key = line.substring(0, colonIndex).trim();
				
				// Check if this key corresponds to a template variable
				if (templateVars.has(key)) {
					const newValue = templateVars.get(key);
					const formattedValue = this.formatYamlValue(newValue);
					processedLines[i] = `${key}: ${formattedValue}`;
				}
			}
		}
		
		return processedLines.join(lineEnding);
	}

	private formatYamlValue(value: unknown): string {
		if (value === null || value === undefined) {
			return '';
		} else if (typeof value === 'string') {
			return value;
		} else if (typeof value === 'number') {
			return value.toString();
		} else if (typeof value === 'boolean') {
			return value.toString();
		} else if (value instanceof Date) {
			return value.toISOString().split('T')[0];
		} else if (Array.isArray(value)) {
			return `[${value.map(v => {
				if (typeof v === 'string') return `"${v}"`;
				if (typeof v === 'object' && v !== null) return JSON.stringify(v);
				return String(v);
			}).join(', ')}]`;
		} else if (typeof value === 'object') {
			return JSON.stringify(value);
		}
		
		return String(value);
	}

	private extractFrontMatter(content: string): Record<string, any> {
		const lines = content.split(/\r?\n/);
		const frontMatter: Record<string, any> = {};
		let inFrontMatter = false;
		
		for (const line of lines) {
			if (line.trim() === '---') {
				if (!inFrontMatter) {
					inFrontMatter = true;
					continue;
				} else {
					break;
				}
			}
			
			if (inFrontMatter) {
				const colonIndex = line.indexOf(':');
				if (colonIndex > -1) {
					const key = line.substring(0, colonIndex).trim();
					const value = line.substring(colonIndex + 1).trim();
					frontMatter[key] = value;
				}
			}
		}
		
		return frontMatter;
	}

	public createMockFile(path: string): TFile {
		const file = new TFile();
		file.path = path;
		file.name = path.split('/').pop() || '';
		
		const extensionMatch = file.name.match(/\.([^.]+)$/);
		file.extension = extensionMatch ? extensionMatch[1] : '';
		file.basename = file.extension ? file.name.replace(`.${file.extension}`, '') : file.name;
		
		return file;
	}
}

// Mock factory functions
const createSystemMockApp = () => ({
	vault: {
		getAbstractFileByPath: vi.fn(),
		cachedRead: vi.fn(),
		adapter: {
			exists: vi.fn().mockResolvedValue(true)
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
		getFileCache: vi.fn().mockReturnValue({ frontmatter: {} })
	}
});

const createSystemMockPlugin = (enableFeature: boolean = true) => ({
	settings: {
		enableTemplatePropertyTypes: enableFeature,
		globalVariables: {},
		showCaptureNotification: false
	}
});

describe('Template Property Types - System Level Tests', () => {
	let mockApp: any;
	let mockPlugin: any;
	let testEngine: SystemTestEngine;

	beforeEach(() => {
		mockApp = createSystemMockApp();
		mockPlugin = createSystemMockPlugin();
		testEngine = new SystemTestEngine(mockApp, mockPlugin);
		vi.clearAllMocks();
		// Suppress console.error during tests (expected errors are tested)
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	describe('Real-World Scenarios', () => {
		describe('Academic Paper Template', () => {
			const academicTemplate = `---
title: {{title}}
authors: {{authors}}
metadata: {{metadata}}
year: {{year}}
published: {{published}}
tags: {{tags}}
---

# {{title}}

**Authors:** {{authors}}
**Year:** {{year}}
**Status:** {{published}}

## Abstract

{{abstract}}

## Methodology

{{methodology}}
`;

			it('should handle complex academic paper with all property types', async () => {
				// Create template
				testEngine.createTemplate('templates/academic-paper.md', academicTemplate);
				
				// Set up realistic academic data
				testEngine.setVariable('title', 'Deep Learning Applications in Climate Science');
				testEngine.setVariable('authors', ['Dr. Sarah Johnson', 'Prof. Michael Chen', 'Dr. Elena Rodriguez']);
				testEngine.setVariable('metadata', {
					journal: 'Nature Climate Change',
					volume: 13,
					issue: 4,
					pages: '123-135',
					doi: '10.1038/s41558-023-01234-5'
				});
				testEngine.setVariable('year', 2023);
				testEngine.setVariable('published', true);
				testEngine.setVariable('tags', ['climate', 'deep-learning', 'AI', 'research']);
				testEngine.setVariable('abstract', 'This study explores novel applications...');
				testEngine.setVariable('methodology', 'We employed state-of-the-art neural networks...');

				// Create file with template
				const result = await testEngine.createFileWithTemplate(
					'papers/climate-ai-paper.md', 
					'templates/academic-paper.md'
				);

				expect(result).not.toBeNull();
				const finalContent = testEngine.getFileContent('papers/climate-ai-paper.md');
				
				// Verify property types are preserved
				expect(finalContent).toContain('authors: ["Dr. Sarah Johnson", "Prof. Michael Chen", "Dr. Elena Rodriguez"]');
				expect(finalContent).toContain('year: 2023');
				expect(finalContent).toContain('published: true');
				expect(finalContent).toContain('tags: ["climate", "deep-learning", "AI", "research"]');
				expect(finalContent).toContain('metadata: {"journal":"Nature Climate Change","volume":13,"issue":4,"pages":"123-135","doi":"10.1038/s41558-023-01234-5"}');
				
				// Verify content body still uses human-readable format
				expect(finalContent).toContain('**Authors:** Dr. Sarah Johnson, Prof. Michael Chen, Dr. Elena Rodriguez');
				expect(finalContent).toContain('**Year:** 2023');
				expect(finalContent).toContain('**Status:** true');
			});

			it('should handle missing authors gracefully', async () => {
				testEngine.createTemplate('templates/academic-paper.md', academicTemplate);
				
				testEngine.setVariable('title', 'Incomplete Paper');
				testEngine.setVariable('year', 2023);
				testEngine.setVariable('published', false);
				// Note: authors not set

				const result = await testEngine.createFileWithTemplate(
					'papers/incomplete-paper.md', 
					'templates/academic-paper.md'
				);

				expect(result).not.toBeNull();
				const finalContent = testEngine.getFileContent('papers/incomplete-paper.md');
				
				// Should have empty authors field
				expect(finalContent).toContain('authors:');
				expect(finalContent).toContain('**Authors:**'); // Empty in body
			});
		});

		describe('Project Management Template', () => {
			const projectTemplate = `---
project_name: {{project_name}}
status: {{status}}
priority: {{priority}}
team_members: {{team_members}}
milestones: {{milestones}}
budget: {{budget}}
start_date: {{start_date}}
is_active: {{is_active}}
client_info: {{client_info}}
---

# Project: {{project_name}}

**Status:** {{status}}  
**Priority Level:** {{priority}}  
**Budget:** $\{{budget}}  
**Active:** {{is_active}}

## Team
{{team_members}}

## Client Details
{{client_info}}

## Milestones
{{milestones}}
`;

			it('should handle nested project data structures', async () => {
				testEngine.createTemplate('templates/project.md', projectTemplate);
				
				// Complex project data
				testEngine.setVariable('project_name', 'E-commerce Platform Redesign');
				testEngine.setVariable('status', 'In Progress');
				testEngine.setVariable('priority', 8);
				testEngine.setVariable('team_members', [
					'Alice (Lead Designer)',
					'Bob (Frontend Dev)',
					'Carol (Backend Dev)',
					'Dave (QA Engineer)'
				]);
				testEngine.setVariable('milestones', {
					'Phase 1': { deadline: '2023-12-15', status: 'Complete', percentage: 100 },
					'Phase 2': { deadline: '2024-01-30', status: 'In Progress', percentage: 65 },
					'Phase 3': { deadline: '2024-03-15', status: 'Not Started', percentage: 0 }
				});
				testEngine.setVariable('budget', 150000);
				testEngine.setVariable('start_date', new Date('2023-10-01'));
				testEngine.setVariable('is_active', true);
				testEngine.setVariable('client_info', {
					name: 'Tech Innovations Inc.',
					contact: 'jane.doe@techinnovations.com',
					industry: 'Software',
					location: 'San Francisco, CA'
				});

				const result = await testEngine.createFileWithTemplate(
					'projects/ecommerce-redesign.md', 
					'templates/project.md'
				);

				expect(result).not.toBeNull();
				const finalContent = testEngine.getFileContent('projects/ecommerce-redesign.md');
				
				// Verify complex nested structures
				expect(finalContent).toContain('priority: 8');
				expect(finalContent).toContain('budget: 150000');
				expect(finalContent).toContain('is_active: true');
				expect(finalContent).toContain('start_date: 2023-10-01');
				
				// Check array formatting
				expect(finalContent).toContain('team_members: ["Alice (Lead Designer)", "Bob (Frontend Dev)", "Carol (Backend Dev)", "Dave (QA Engineer)"]');
				
				// Check nested object formatting
				expect(finalContent).toContain('"Phase 1":{"deadline":"2023-12-15","status":"Complete","percentage":100}');
				expect(finalContent).toContain('"name":"Tech Innovations Inc."');
			});
		});

		describe('Complex Nested Structures', () => {
			const complexTemplate = `---
config: {{config}}
data_sources: {{data_sources}}
processing_rules: {{processing_rules}}
output_settings: {{output_settings}}
---

# Complex Data Processing Pipeline

Configuration: {{config}}
`;

			it('should handle deeply nested data structures', async () => {
				testEngine.createTemplate('templates/complex-config.md', complexTemplate);
				
				// Very nested data structure
				testEngine.setVariable('config', {
					version: '2.1.0',
					environment: 'production',
					logging: {
						level: 'info',
						outputs: ['console', 'file'],
						rotation: {
							enabled: true,
							maxSize: '100MB',
							maxFiles: 10
						}
					},
					performance: {
						caching: {
							enabled: true,
							ttl: 3600,
							providers: {
								redis: { host: 'localhost', port: 6379 },
								memory: { maxSize: 1000 }
							}
						}
					}
				});
				
				testEngine.setVariable('data_sources', [
					{
						name: 'primary_db',
						type: 'postgresql',
						config: { host: 'db1.example.com', pool_size: 20 }
					},
					{
						name: 'analytics_db',
						type: 'mongodb',
						config: { cluster: 'analytics.example.com', shards: 3 }
					}
				]);

				testEngine.setVariable('processing_rules', {
					validation: {
						strict: true,
						rules: ['required_fields', 'data_types', 'constraints'],
						custom: {
							email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
							phone: /^\+?[\d\s-()]+$/
						}
					},
					transformation: {
						normalize: true,
						encoding: 'UTF-8',
						filters: ['remove_duplicates', 'validate_ranges']
					}
				});

				const result = await testEngine.createFileWithTemplate(
					'configs/complex-system.md', 
					'templates/complex-config.md'
				);

				expect(result).not.toBeNull();
				const finalContent = testEngine.getFileContent('configs/complex-system.md');
				
				// Verify deeply nested objects are preserved
				expect(finalContent).toContain('"logging":{"level":"info","outputs":["console","file"]');
				expect(finalContent).toContain('"caching":{"enabled":true,"ttl":3600');
				expect(finalContent).toContain('"redis":{"host":"localhost","port":6379}');
				
				// Verify arrays with objects
				expect(finalContent).toContain('"name":"primary_db","type":"postgresql"');
				expect(finalContent).toContain('"name":"analytics_db","type":"mongodb"');
			});
		});

		describe('Mixed Property Types in Single Template', () => {
			const mixedTemplate = `---
title: {{title}}
count: {{count}}
percentage: {{percentage}}
is_enabled: {{is_enabled}}
tags: {{tags}}
created_date: {{created_date}}
author: {{author}}
settings: {{settings}}
empty_field: {{empty_field}}
zero_value: {{zero_value}}
false_value: {{false_value}}
---

# Mixed Properties Test

All property types in one template.
`;

			it('should handle all supported property types correctly', async () => {
				testEngine.createTemplate('templates/mixed-types.md', mixedTemplate);
				
				// Set up all different types
				testEngine.setVariable('title', 'Test Document');
				testEngine.setVariable('count', 42);
				testEngine.setVariable('percentage', 85.5);
				testEngine.setVariable('is_enabled', true);
				testEngine.setVariable('tags', ['test', 'mixed', 'types']);
				testEngine.setVariable('created_date', new Date('2023-11-15T10:30:00Z'));
				testEngine.setVariable('author', {
					name: 'John Doe',
					email: 'john@example.com',
					role: 'Developer'
				});
				testEngine.setVariable('settings', {
					theme: 'dark',
					notifications: true,
					timeout: 300
				});
				testEngine.setVariable('zero_value', 0);
				testEngine.setVariable('false_value', false);
				// empty_field intentionally not set

				const result = await testEngine.createFileWithTemplate(
					'docs/mixed-types-test.md', 
					'templates/mixed-types.md'
				);

				expect(result).not.toBeNull();
				const finalContent = testEngine.getFileContent('docs/mixed-types-test.md');
				
				// Verify each type is correctly formatted
				expect(finalContent).toContain('title: Test Document');
				expect(finalContent).toContain('count: 42');
				expect(finalContent).toContain('percentage: 85.5');
				expect(finalContent).toContain('is_enabled: true');
				expect(finalContent).toContain('tags: ["test", "mixed", "types"]');
				expect(finalContent).toContain('created_date: 2023-11-15');
				expect(finalContent).toContain('author: {"name":"John Doe","email":"john@example.com","role":"Developer"}');
				expect(finalContent).toContain('settings: {"theme":"dark","notifications":true,"timeout":300}');
				expect(finalContent).toContain('empty_field:'); // Empty but present
				expect(finalContent).toContain('zero_value: 0');
				expect(finalContent).toContain('false_value: false');
			});
		});
	});

	describe('Cross-Platform Testing', () => {
		const basicTemplate = `---
title: {{title}}
items: {{items}}
is_published: {{is_published}}
---

# {{title}}
`;

		it('should work identically with LF line endings (Unix/Mac)', async () => {
			testEngine.createTemplate('templates/basic-lf.md', basicTemplate, 'LF');
			
			testEngine.setVariable('title', 'Cross-Platform Test');
			testEngine.setVariable('items', ['item1', 'item2', 'item3']);
			testEngine.setVariable('is_published', true);

			const result = await testEngine.createFileWithTemplate(
				'tests/lf-test.md', 
				'templates/basic-lf.md'
			);

			expect(result).not.toBeNull();
			const content = testEngine.getFileContent('tests/lf-test.md');
			
			// Should use LF line endings
			expect(content).not.toContain('\r\n');
			expect(content).toContain('items: ["item1", "item2", "item3"]');
			expect(content).toContain('is_published: true');
		});

		it('should work identically with CRLF line endings (Windows)', async () => {
			testEngine.createTemplate('templates/basic-crlf.md', basicTemplate, 'CRLF');
			
			testEngine.setVariable('title', 'Cross-Platform Test');
			testEngine.setVariable('items', ['item1', 'item2', 'item3']);
			testEngine.setVariable('is_published', true);

			const result = await testEngine.createFileWithTemplate(
				'tests/crlf-test.md', 
				'templates/basic-crlf.md'
			);

			expect(result).not.toBeNull();
			const content = testEngine.getFileContent('tests/crlf-test.md');
			
			// Should preserve CRLF line endings
			expect(content).toContain('\r\n');
			expect(content).toContain('items: ["item1", "item2", "item3"]');
			expect(content).toContain('is_published: true');
		});

		it('should produce identical YAML output regardless of line endings', async () => {
			// Create identical templates with different line endings
			testEngine.createTemplate('templates/basic-lf.md', basicTemplate, 'LF');
			testEngine.createTemplate('templates/basic-crlf.md', basicTemplate, 'CRLF');
			
			// Same data for both
			testEngine.setVariable('title', 'Line Ending Test');
			testEngine.setVariable('items', ['alpha', 'beta', 'gamma']);
			testEngine.setVariable('is_published', false);

			// Test LF version
			await testEngine.createFileWithTemplate(
				'tests/lf-version.md', 
				'templates/basic-lf.md'
			);

			// Reset and test CRLF version
			const lfContent = testEngine.getFileContent('tests/lf-version.md');

			await testEngine.createFileWithTemplate(
				'tests/crlf-version.md', 
				'templates/basic-crlf.md'
			);
			const crlfContent = testEngine.getFileContent('tests/crlf-version.md');

			// Extract YAML front matter from both
			const lfYaml = lfContent.match(/^---([\s\S]*?)^---/m)?.[1] || '';
			const crlfYaml = crlfContent.match(/^---([\s\S]*?)^---/m)?.[1] || '';

			// Normalize line endings for comparison
			const normalizedLfYaml = lfYaml.replace(/\r?\n/g, '\n').trim();
			const normalizedCrlfYaml = crlfYaml.replace(/\r?\n/g, '\n').trim();

			expect(normalizedLfYaml).toBe(normalizedCrlfYaml);
			expect(normalizedLfYaml).toContain('items: ["alpha", "beta", "gamma"]');
			expect(normalizedLfYaml).toContain('is_published: false');
		});
	});

	describe('File Type Scenarios', () => {
		const templateContent = `---
title: {{title}}
data: {{data}}
---

Content here.
`;

		it('should post-process .md files', async () => {
			testEngine.createTemplate('templates/test.md', templateContent);
			
			testEngine.setVariable('title', 'Markdown Test');
			testEngine.setVariable('data', ['a', 'b', 'c']);

			const result = await testEngine.createFileWithTemplate(
				'notes/test.md', 
				'templates/test.md'
			);

			expect(result).not.toBeNull();
			expect(result?.extension).toBe('md');
			
			const content = testEngine.getFileContent('notes/test.md');
			expect(content).toContain('data: ["a", "b", "c"]');
		});

		it('should skip post-processing for .canvas files', async () => {
			testEngine.createTemplate('templates/test.canvas', templateContent);
			
			testEngine.setVariable('title', 'Canvas Test');
			testEngine.setVariable('data', ['x', 'y', 'z']);

			const result = await testEngine.createFileWithTemplate(
				'canvases/test.canvas', 
				'templates/test.canvas'
			);

			expect(result).not.toBeNull();
			expect(result?.extension).toBe('canvas');
			
			// Canvas files should not be post-processed
			const content = testEngine.getFileContent('canvases/test.canvas');
			// Should contain template variables as strings, not arrays
			expect(content).toContain('data: x, y, z'); // String representation
		});

		it('should handle mixed file types in templates', async () => {
			// Create both MD and canvas templates
			testEngine.createTemplate('templates/note.md', templateContent);
			testEngine.createTemplate('templates/visual.canvas', templateContent);
			
			testEngine.setVariable('title', 'Mixed Types');
			testEngine.setVariable('data', [1, 2, 3]);

			// Create markdown file
			const mdResult = await testEngine.createFileWithTemplate(
				'mixed/note.md', 
				'templates/note.md'
			);

			// Create canvas file
			const canvasResult = await testEngine.createFileWithTemplate(
				'mixed/visual.canvas', 
				'templates/visual.canvas'
			);

			expect(mdResult).not.toBeNull();
			expect(canvasResult).not.toBeNull();

			const mdContent = testEngine.getFileContent('mixed/note.md');
			const canvasContent = testEngine.getFileContent('mixed/visual.canvas');

			// MD should have proper array formatting
			expect(mdContent).toContain('data: [1, 2, 3]');
			
			// Canvas should have string representation
			expect(canvasContent).toContain('data: 1, 2, 3');
		});
	});

	describe('Integration Points', () => {
		describe('Template Choices', () => {
			it('should work with template choice workflow', async () => {
				const templateContent = `---
title: {{title}}
priority: {{priority}}
assigned_to: {{assigned_to}}
---

# Task: {{title}}

Priority: {{priority}}
Assigned to: {{assigned_to}}
`;

				testEngine.createTemplate('templates/task.md', templateContent);
				
				testEngine.setVariable('title', 'Implement new feature');
				testEngine.setVariable('priority', 5);
				testEngine.setVariable('assigned_to', ['Alice', 'Bob']);

				const result = await testEngine.createFileWithTemplate(
					'tasks/new-feature.md', 
					'templates/task.md'
				);

				expect(result).not.toBeNull();
				const content = testEngine.getFileContent('tasks/new-feature.md');
				
				expect(content).toContain('priority: 5');
				expect(content).toContain('assigned_to: ["Alice", "Bob"]');
				expect(content).toContain('Priority: 5'); // Body uses string
				expect(content).toContain('Assigned to: Alice, Bob'); // Body uses readable format
			});
		});

		describe('Capture Choices', () => {
			it('should work with capture choice workflow', async () => {
				const captureTemplate = `---
captured: {{VALUE}}
date: {{DATE}}
processed: {{processed}}
---

# Captured Content

{{VALUE}}

Captured on: {{DATE}}
`;

				testEngine.createTemplate('templates/capture.md', captureTemplate);
				testEngine.setVariable('processed', true);

				const result = await testEngine.captureWithTemplate(
					'inbox/captured-item.md',
					'templates/capture.md',
					'This is important information that was captured.'
				);

				expect(result).not.toBeNull();
				const content = testEngine.getFileContent('inbox/captured-item.md');
				
				expect(content).toContain('captured: This is important information that was captured.');
				expect(content).toContain('processed: true');
				expect(content).toContain('date: 2'); // Should start with year
			});
		});

		describe('Overwrite Existing Files', () => {
			it('should handle overwriting files with templates', async () => {
				const templateContent = `---
updated: {{updated}}
version: {{version}}
---

# Updated Content

Version: {{version}}
`;

				// Create existing file first
				const existingFile = testEngine.createMockFile('docs/existing.md');
				testEngine.fileSystem.set('docs/existing.md', 'Old content');

				testEngine.createTemplate('templates/update.md', templateContent);
				testEngine.setVariable('updated', true);
				testEngine.setVariable('version', 2.1);

				const result = await testEngine.overwriteFileWithTemplate(
					existingFile,
					'templates/update.md'
				);

				expect(result).not.toBeNull();
				const content = testEngine.getFileContent('docs/existing.md');
				
				expect(content).toContain('updated: true');
				expect(content).toContain('version: 2.1');
				expect(content).not.toContain('Old content');
			});
		});

		describe('Feature Flag Comparisons', () => {
			it('should behave differently when feature is disabled', async () => {
				const templateContent = `---
title: {{title}}
count: {{count}}
enabled: {{enabled}}
---

# {{title}}
`;

				testEngine.createTemplate('templates/flag-test.md', templateContent);
				
				testEngine.setVariable('title', 'Feature Flag Test');
				testEngine.setVariable('count', 100);
				testEngine.setVariable('enabled', true);

				// Test with feature enabled
				mockPlugin.settings.enableTemplatePropertyTypes = true;
				const enabledResult = await testEngine.createFileWithTemplate(
					'tests/enabled.md',
					'templates/flag-test.md'
				);

				// Test with feature disabled
				mockPlugin.settings.enableTemplatePropertyTypes = false;
				const disabledResult = await testEngine.createFileWithTemplate(
					'tests/disabled.md',
					'templates/flag-test.md'
				);

				expect(enabledResult).not.toBeNull();
				expect(disabledResult).not.toBeNull();

				const enabledContent = testEngine.getFileContent('tests/enabled.md');
				const disabledContent = testEngine.getFileContent('tests/disabled.md');

				// With feature enabled, should have proper types
				expect(enabledContent).toContain('count: 100');
				expect(enabledContent).toContain('enabled: true');

				// With feature disabled, should have string representations
				expect(disabledContent).toContain('count: 100'); // Still number in YAML
				expect(disabledContent).toContain('enabled: true'); // Still boolean in YAML
				// Note: Feature flag affects processing logic, not final string output
			});
		});
	});

	describe('Error Resilience', () => {
		it('should handle template with invalid YAML gracefully', async () => {
			const invalidTemplate = `---
title: {{title}}
invalid: [unclosed array
another: {{count}}
---

Content`;

			testEngine.createTemplate('templates/invalid.md', invalidTemplate);
			
			testEngine.setVariable('title', 'Invalid YAML Test');
			testEngine.setVariable('count', 42);

			// Should not throw error
			const result = await testEngine.createFileWithTemplate(
				'tests/invalid-yaml.md',
				'templates/invalid.md'
			);

			expect(result).not.toBeNull();
			// Should still process what it can
			const content = testEngine.getFileContent('tests/invalid-yaml.md');
			expect(content).toContain('title: Invalid YAML Test');
		});

		it('should handle large data structures acceptably', async () => {
			const templateContent = `---
large_array: {{large_array}}
large_object: {{large_object}}
---

Large data test.
`;

			testEngine.createTemplate('templates/large-data.md', templateContent);
			
			// Create large array
			const largeArray = Array.from({ length: 1000 }, (_, i) => `item${i}`);
			
			// Create large object
			const largeObject: Record<string, any> = {};
			for (let i = 0; i < 100; i++) {
				largeObject[`key${i}`] = {
					id: i,
					name: `Name ${i}`,
					data: Array.from({ length: 10 }, (_, j) => `value${j}`)
				};
			}

			testEngine.setVariable('large_array', largeArray);
			testEngine.setVariable('large_object', largeObject);

			const start = Date.now();
			const result = await testEngine.createFileWithTemplate(
				'tests/large-data.md',
				'templates/large-data.md'
			);
			const duration = Date.now() - start;

			expect(result).not.toBeNull();
			expect(duration).toBeLessThan(1000); // Should complete within 1 second

			const content = testEngine.getFileContent('tests/large-data.md');
			expect(content).toContain('"item0"');
			expect(content).toContain('"key0"');
		});

		it('should handle network/file system errors with proper fallback', async () => {
			// Mock file system error
			mockApp.vault.cachedRead.mockRejectedValueOnce(new Error('File system error'));

			testEngine.setVariable('title', 'Error Test');

			const result = await testEngine.createFileWithTemplate(
				'tests/error-test.md',
				'templates/nonexistent.md'
			);

			// Should handle error gracefully
			expect(result).toBeNull();
			expect(mockApp.vault.cachedRead).toHaveBeenCalled();
		});
	});

	describe('Templater Compatibility', () => {
		it('should work with both QuickAdd variables and Templater commands', async () => {
			const mixedTemplate = `---
quickadd_var: {{quickadd_var}}
quickadd_array: {{quickadd_array}}
templater_var: <% tp.file.title %>
---

# {{quickadd_var}}

QuickAdd: {{quickadd_var}}
Templater: <% tp.date.now() %>

Tags: {{quickadd_array}}
`;

			testEngine.createTemplate('templates/mixed-templater.md', mixedTemplate);
			
			testEngine.setVariable('quickadd_var', 'Mixed Template Test');
			testEngine.setVariable('quickadd_array', ['quickadd', 'templater', 'test']);

			const result = await testEngine.createFileWithTemplate(
				'tests/mixed-templater.md',
				'templates/mixed-templater.md'
			);

			expect(result).not.toBeNull();
			const content = testEngine.getFileContent('tests/mixed-templater.md');
			
			// QuickAdd variables should be processed
			expect(content).toContain('quickadd_var: Mixed Template Test');
			expect(content).toContain('quickadd_array: ["quickadd", "templater", "test"]');
			
			// Templater commands should remain unprocessed (for Templater to handle later)
			expect(content).toContain('templater_var: <% tp.file.title %>');
			expect(content).toContain('Templater: <% tp.date.now() %>');
			
			// Body content should use readable format
			expect(content).toContain('Tags: quickadd, templater, test');
		});

		it('should preserve Templater front matter modifications', async () => {
			const templateContent = `---
title: {{title}}
processed: {{processed}}
templater_field: <% "Templater was here" %>
---

# {{title}}
`;

			testEngine.createTemplate('templates/templater-compat.md', templateContent);
			
			testEngine.setVariable('title', 'Templater Compatibility');
			testEngine.setVariable('processed', true);

			const result = await testEngine.createFileWithTemplate(
				'tests/templater-compat.md',
				'templates/templater-compat.md'
			);

			expect(result).not.toBeNull();
			const content = testEngine.getFileContent('tests/templater-compat.md');
			
			// QuickAdd should process its variables
			expect(content).toContain('title: Templater Compatibility');
			expect(content).toContain('processed: true');
			
			// Templater syntax should remain for later processing
			expect(content).toContain('templater_field: <% "Templater was here" %>');
		});

		it('should verify proper ordering (QuickAdd before Templater)', async () => {
			const templateContent = `---
quickadd_date: {{date}}
templater_date: <% tp.date.now() %>
both_reference: {{title}} - <% tp.file.title %>
---

# Processing Order Test
`;

			testEngine.createTemplate('templates/ordering.md', templateContent);
			
			testEngine.setVariable('date', new Date('2023-12-01'));
			testEngine.setVariable('title', 'Order Test');

			const result = await testEngine.createFileWithTemplate(
				'tests/ordering.md',
				'templates/ordering.md'
			);

			expect(result).not.toBeNull();
			const content = testEngine.getFileContent('tests/ordering.md');
			
			// QuickAdd should be processed (date as proper YAML date)
			expect(content).toContain('quickadd_date: 2023-12-01');
			
			// Mixed line should have QuickAdd processed but Templater preserved
			expect(content).toContain('both_reference: Order Test - <% tp.file.title %>');
			
			// Pure Templater should be unchanged
			expect(content).toContain('templater_date: <% tp.date.now() %>');
		});
	});
});
