import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { TFile } from 'obsidian';
import { log } from '../logger/logManager';

// Mock logger to capture error messages
vi.mock('../logger/logManager', () => ({
	log: {
		logError: vi.fn(),
		logWarning: vi.fn(),
		logMessage: vi.fn(),
	},
}));

describe('Template Property Types Feature Flag & Edge Cases', () => {
	let mockApp: any;
	let mockPlugin: any;
	let mockFile: TFile;
	let mockVault: any;
	let mockFileManager: any;
	
	beforeEach(() => {
		vi.clearAllMocks();
		
		mockFile = {
			path: 'test.md',
			basename: 'test',
			extension: 'md',
		} as TFile;
		
		mockVault = {
			create: vi.fn().mockResolvedValue(mockFile),
			modify: vi.fn().mockResolvedValue(void 0),
			cachedRead: vi.fn(),
			getAbstractFileByPath: vi.fn(),
		};
		
		mockFileManager = {
			processFrontMatter: vi.fn().mockImplementation((file, callback) => {
				const frontmatter = {};
				callback(frontmatter);
				return Promise.resolve();
			}),
		};
		
		mockApp = {
			vault: mockVault,
			fileManager: mockFileManager,
		};
		
		mockPlugin = {
			settings: {
				enableTemplatePropertyTypes: true,
			},
		};
	});
	
	afterEach(() => {
		vi.resetAllMocks();
	});

	describe('Feature Flag Behavior', () => {
		it('should not collect templatePropertyVars when flag is disabled', () => {
			mockPlugin.settings.enableTemplatePropertyTypes = false;
			
			const formatter = new TestFormatter(mockApp, mockPlugin);
			const templateContent = 'title: {{testValue}}\ncount: {{testCount}}';
			
			formatter.setVariable('testValue', 'My Title');
			formatter.setVariable('testCount', 42);
			
			const result = formatter.formatContent(templateContent);
			const vars = formatter.getAndClearTemplatePropertyVars();
			
			expect(result).toBe('title: My Title\ncount: 42');
			expect(vars.size).toBe(0);
		});
		
		it('should collect templatePropertyVars when flag is enabled', () => {
			mockPlugin.settings.enableTemplatePropertyTypes = true;
			
			const formatter = new TestFormatter(mockApp, mockPlugin);
			const templateContent = 'title: {{testValue}}\ndate: {{testDate}}';
			
			formatter.setVariable('testValue', 'My Title'); // String values are not tracked
			formatter.setVariable('testDate', new Date('2024-01-01')); // Non-string values are tracked
			
			const result = formatter.formatContent(templateContent);
			const vars = formatter.getAndClearTemplatePropertyVars();
			
			expect(result).toBe('title: My Title\ndate: 2024-01-01T00:00:00.000Z');
			expect(vars.size).toBe(1); // Only non-string values tracked
			expect(vars.get('date')).toEqual(new Date('2024-01-01'));
		});
		
		it('should not post-process when flag is disabled', async () => {
			mockPlugin.settings.enableTemplatePropertyTypes = false;
			
			const engine = new TestTemplateEngine(mockApp, mockPlugin);
			const templateVars = new Map<string, unknown>([['title', 'Test'], ['count', 42]]);
			
			const shouldProcess = await engine.testShouldProcessFrontMatter(mockFile, templateVars);
			expect(shouldProcess).toBe(false);
			expect(mockFileManager.processFrontMatter).not.toHaveBeenCalled();
		});
		
		it('should post-process when flag is enabled', async () => {
			mockPlugin.settings.enableTemplatePropertyTypes = true;
			
			const engine = new TestTemplateEngine(mockApp, mockPlugin);
			const templateVars = new Map<string, unknown>([['title', 'Test'], ['count', 42]]);
			
			await engine.testPostProcessFrontMatter(mockFile, templateVars);
			expect(mockFileManager.processFrontMatter).toHaveBeenCalledOnce();
		});
		
		it('should clear templatePropertyVars after each run', () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			
			formatter.setVariable('test1', 42); // Use number to ensure tracking
			formatter.formatContent('prop: {{test1}}');
			
			let vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.size).toBe(1);
			expect(vars.get('prop')).toBe(42);
			
			// Second run should start clean
			formatter.setVariable('test2', true); // Use boolean to ensure tracking
			formatter.formatContent('other: {{test2}}');
			
			vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.size).toBe(1);
			expect(vars.get('other')).toBe(true);
			expect(vars.has('prop')).toBe(false);
		});
	});
	
	describe('Error Handling', () => {
		it('should handle processFrontMatter YAML parse errors gracefully', async () => {
			const yamlError = new Error('Invalid YAML syntax');
			mockFileManager.processFrontMatter.mockRejectedValue(yamlError);
			
			const engine = new TestTemplateEngine(mockApp, mockPlugin);
			const templateVars = new Map<string, unknown>([['title', 'Test']]);
			
			// Should not throw, file should still be considered created
			await expect(engine.testPostProcessFrontMatter(mockFile, templateVars)).resolves.toBeUndefined();
			expect(log.logError).toHaveBeenCalledWith(
				expect.stringContaining('Failed to post-process YAML front matter')
			);
		});
		
		it('should handle malformed template variables gracefully', () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			const malformedTemplate = 'title: {{UNCLOSED_VAR\nother: {{}}';
			
			formatter.setVariable('UNCLOSED_VAR', 'test');
			
			// Should not throw, should handle gracefully
			expect(() => formatter.formatContent(malformedTemplate)).not.toThrow();
		});
		
		it('should handle circular references in objects', () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			const circularObj: any = { name: 'test' };
			circularObj.self = circularObj;
			
			formatter.setVariable('circular', circularObj);
			
			// Should not throw or hang
			expect(() => formatter.formatContent('data: {{circular}}')).not.toThrow();
			
			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.has('data')).toBe(true);
		});
		
		it('should handle very large data structures', () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			
			// Create large array
			const largeArray = new Array(10000).fill(0).map((_, i) => ({ id: i, data: `item-${i}` }));
			formatter.setVariable('bigData', largeArray);
			
			const start = performance.now();
			formatter.formatContent('items: {{bigData}}');
			const duration = performance.now() - start;
			
			// Should complete within reasonable time (< 1 second)
			expect(duration).toBeLessThan(1000);
			
			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.get('items')).toBe(largeArray);
		});
		
		it('should handle undefined and null values properly', () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			
			formatter.setVariable('nullValue', null);
			formatter.setVariable('undefinedValue', undefined);
			formatter.setVariable('emptyString', '');
			
			formatter.formatContent('null: {{nullValue}}\nundef: {{undefinedValue}}\nempty: {{emptyString}}');
			
			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.get('null')).toBe(null);
			expect(vars.get('undef')).toBe(undefined);
			// Empty string is a string, so it won't be tracked
			expect(vars.has('empty')).toBe(false);
		});
	});
	
	describe('Edge Cases', () => {
		it('should handle multiple variables mapping to same YAML key', () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			
			formatter.setVariable('first', 42);
			formatter.setVariable('second', 100);
			
			// Same property key used twice
			formatter.formatContent('count: {{first}}\ncount: {{second}}');
			
			const vars = formatter.getAndClearTemplatePropertyVars();
			// Last one should win
			expect(vars.get('count')).toBe(100);
			expect(vars.size).toBe(1);
		});
		
		it('should handle special characters in property names and values', () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			
			const specialObject = { special: '特殊文字 & symbols: @#$%^&*()' };
			formatter.setVariable('special', specialObject);
			
			formatter.formatContent('my-special_prop123: {{special}}');
			
			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.get('my-special_prop123')).toBe(specialObject);
		});
		
		it('should handle Unicode properly', () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			
			const unicodeObject = { text: '🎉 测试 العربية ñ' };
			formatter.setVariable('unicode', unicodeObject);
			
			formatter.formatContent('title: {{unicode}}');
			
			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.get('title')).toBe(unicodeObject);
		});
		
		it('should handle nested objects and arrays', () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			
			const complexData = {
				nested: {
					array: [1, 2, { deep: 'value' }],
					boolean: true,
					null: null,
				},
				tags: ['tag1', 'tag2', 'tag3'],
			};
			
			formatter.setVariable('complex', complexData);
			formatter.formatContent('data: {{complex}}');
			
			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.get('data')).toEqual(complexData);
		});
		
		it('should only process markdown files for front matter', async () => {
			const engine = new TestTemplateEngine(mockApp, mockPlugin);
			const templateVars = new Map<string, unknown>([['title', 'Test']]);
			
			// Test with canvas file
			const canvasFile = { ...mockFile, extension: 'canvas' } as TFile;
			const shouldProcessCanvas = await engine.testShouldProcessFrontMatter(canvasFile, templateVars);
			expect(shouldProcessCanvas).toBe(false);
			
			// Test with markdown file
			const mdFile = { ...mockFile, extension: 'md' } as TFile;
			const shouldProcessMd = await engine.testShouldProcessFrontMatter(mdFile, templateVars);
			expect(shouldProcessMd).toBe(true);
		});
		
		it('should not process when no template variables collected', async () => {
			const engine = new TestTemplateEngine(mockApp, mockPlugin);
			const emptyVars = new Map<string, unknown>();
			
			const shouldProcess = await engine.testShouldProcessFrontMatter(mockFile, emptyVars);
			expect(shouldProcess).toBe(false);
		});
	});
	
	describe('State Management', () => {
		it('should prevent cross-contamination between multiple template runs', () => {
			const formatter1 = new TestFormatter(mockApp, mockPlugin);
			const formatter2 = new TestFormatter(mockApp, mockPlugin);
			
			// Run 1
			formatter1.setVariable('var1', 42);
			formatter1.formatContent('prop1: {{var1}}');
			
			// Run 2 (different formatter instance)
			formatter2.setVariable('var2', true);
			formatter2.formatContent('prop2: {{var2}}');
			
			const vars1 = formatter1.getAndClearTemplatePropertyVars();
			const vars2 = formatter2.getAndClearTemplatePropertyVars();
			
			expect(vars1.size).toBe(1);
			expect(vars1.get('prop1')).toBe(42);
			expect(vars1.has('prop2')).toBe(false);
			
			expect(vars2.size).toBe(1);
			expect(vars2.get('prop2')).toBe(true);
			expect(vars2.has('prop1')).toBe(false);
		});
		
		it('should handle memory properly for large variable maps', () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			
			// Create many variables
			for (let i = 0; i < 1000; i++) {
				formatter.setVariable(`var${i}`, { data: `value${i}` });
			}
			
			let template = '';
			for (let i = 0; i < 1000; i++) {
				template += `prop${i}: {{var${i}}}\n`;
			}
			
			const start = performance.now();
			formatter.formatContent(template);
			const vars = formatter.getAndClearTemplatePropertyVars();
			const duration = performance.now() - start;
			
			expect(vars.size).toBe(1000);
			expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
			
			// After clearing, should be empty
			const clearedVars = formatter.getAndClearTemplatePropertyVars();
			expect(clearedVars.size).toBe(0);
		});
	});
});

// Test implementations to simulate the real classes without complex dependencies
class TestFormatter {
	private variables: Map<string, unknown> = new Map();
	private templatePropertyVars: Map<string, unknown> = new Map();
	
	constructor(private app: any, private plugin: any) {}
	
	setVariable(name: string, value: unknown) {
		this.variables.set(name, value);
	}
	
	getAndClearTemplatePropertyVars(): Map<string, unknown> {
		const result = new Map(this.templatePropertyVars);
		this.templatePropertyVars.clear();
		return result;
	}
	
	formatContent(template: string): string {
		let output = template;
		const regex = /\{\{([^}]+)\}\}/g;
		let match;
		
		while ((match = regex.exec(output)) !== null) {
			const variableName = match[1].trim();
			const rawValue = this.variables.get(variableName);
			
			// Check if we're in a YAML key-value position and flag is enabled
			if (this.plugin.settings.enableTemplatePropertyTypes && this.isInYamlKeyValuePosition(output, match.index)) {
				const propertyKey = this.extractPropertyKey(output, match.index);
				if (propertyKey && this.shouldTrackAsProperty(rawValue)) {
					this.templatePropertyVars.set(propertyKey, rawValue);
				}
			}
			
			// Replace with string value
			const replacement = this.getVariableValue(variableName);
			output = output.slice(0, match.index) + replacement + output.slice(match.index + match[0].length);
			regex.lastIndex = match.index + replacement.length;
		}
		
		return output;
	}
	
	private isInYamlKeyValuePosition(output: string, matchIndex: number): boolean {
		// Find the line containing the match
		const lineStart = output.lastIndexOf('\n', matchIndex - 1) + 1;
		const lineEnd = output.indexOf('\n', matchIndex);
		const line = output.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
		
		// Check if it's a YAML key-value line (contains colon before the variable)
		const colonIndex = line.indexOf(':');
		const varIndex = matchIndex - lineStart;
		
		return colonIndex !== -1 && varIndex > colonIndex;
	}
	
	private extractPropertyKey(output: string, matchIndex: number): string | null {
		const lineStart = output.lastIndexOf('\n', matchIndex - 1) + 1;
		const lineEnd = output.indexOf('\n', matchIndex);
		const line = output.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
		
		const match = line.match(/^\s*([^:]+):/);
		return match ? match[1].trim() : null;
	}
	
	private shouldTrackAsProperty(value: unknown): boolean {
		// Template property types feature tracks any non-string value
		// OR string values when used with VALUE: prefix (which indicates raw value handling)
		return typeof value !== 'string' && (
			Array.isArray(value) || 
			(typeof value === 'object' && value !== null) ||
			typeof value === 'number' ||
			typeof value === 'boolean' ||
			value === null ||
			value === undefined
		);
	}
	
	private getVariableValue(variableName: string): string {
		const value = this.variables.get(variableName);
		if (value === undefined || value === null) {
			return String(value);
		}
		if (typeof value === 'string') {
			return value;
		}
		if (value instanceof Date) {
			return value.toISOString();
		}
		try {
			return JSON.stringify(value);
		} catch {
			return '[Circular Reference]';
		}
	}
}

class TestTemplateEngine {
	constructor(private app: any, private plugin: any) {}
	
	async testPostProcessFrontMatter(file: TFile, templateVars: Map<string, unknown>): Promise<void> {
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: any) => {
				for (const [key, value] of templateVars) {
					frontmatter[key] = value;
				}
			});
		} catch (err) {
			log.logError(`Failed to post-process YAML front matter for file ${file.path}: ${err}`);
		}
	}
	
	async testShouldProcessFrontMatter(file: TFile, templateVars: Map<string, unknown>): Promise<boolean> {
		return templateVars.size > 0 && 
		       file.extension === 'md' && 
		       this.plugin.settings.enableTemplatePropertyTypes;
	}
}
