import { TemplatePropertyCollector } from "../utils/TemplatePropertyCollector";
import { CompleteFormatter } from "../formatters/completeFormatter";
import type QuickAdd from "../main";
import { createChoiceExecutor } from "../../tests/helpers/createChoiceExecutor";
import { postProcessFrontMatter, shouldPostProcessFrontMatter } from "./helpers/frontmatterPostProcessor";
vi.mock("../main", () => ({ default: class {} }));
vi.mock("../quickAddSettingsTab", () => ({ DEFAULT_SETTINGS: {}, QuickAddSettingsTab: class {} }));
vi.mock("obsidian-dataview", () => ({ getAPI: vi.fn() }));
import type { App, TFile } from 'obsidian';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { itPerf } from '../../tests/perfUtils';
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
			workspace: { getActiveFile: () => null, getActiveViewOfType: () => null, getLeavesOfType: () => [] },
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
		it('does not collect bare scalars (strings/numbers) when the flag is disabled', async () => {
			mockPlugin.settings.enableTemplatePropertyTypes = false;

			const formatter = new TestFormatter(mockApp, mockPlugin);
			const templateContent = 'title: {{testValue}}\ncount: {{testCount}}';

			formatter.setVariable('testValue', 'My Title');
			formatter.setVariable('testCount', 42);

			const result = await formatter.formatContent(templateContent);
			const vars = formatter.getAndClearTemplatePropertyVars();

			// Scalars are YAML-safe inline, so they stay raw (no whole-frontmatter rewrite).
			expect(result).toBe('title: My Title\ncount: 42');
			expect(vars.size).toBe(0);
		});

		it('collects container values (arrays/objects) even when the flag is disabled', async () => {
			mockPlugin.settings.enableTemplatePropertyTypes = false;

			const formatter = new TestFormatter(mockApp, mockPlugin);
			formatter.setVariable('cast', ['[[A]]', '[[B]]']);

			await formatter.formatContent('cast: {{cast}}');
			const vars = formatter.getAndClearTemplatePropertyVars();

			// This is the #662 fix: arrays become real List properties regardless of the toggle.
			expect(vars.get('cast')).toEqual(['[[A]]', '[[B]]']);
		});

		it('should collect templatePropertyVars when flag is enabled', async () => {
			mockPlugin.settings.enableTemplatePropertyTypes = true;

			const formatter = new TestFormatter(mockApp, mockPlugin);
			const templateContent = 'title: {{testValue}}\ndate: {{testDate}}';

			formatter.setVariable('testValue', 'My Title'); // String values are not tracked
			formatter.setVariable('testDate', new Date('2024-01-01')); // Non-string values are tracked

			const result = await formatter.formatContent(templateContent);
			const vars = formatter.getAndClearTemplatePropertyVars();

			expect(result).toBe('title: My Title\ndate: {}');
			expect(vars.size).toBe(1); // Only non-string values tracked
			expect(vars.get('date')).toEqual(new Date('2024-01-01'));
		});

		it('post-processes whenever there are collected vars (flag-independent)', async () => {
			mockPlugin.settings.enableTemplatePropertyTypes = false;


			const templateVars = new Map<string, unknown>([['cast', ['[[A]]']]]);

			const shouldProcess = await shouldPostProcessFrontMatter(mockFile, templateVars);
			expect(shouldProcess).toBe(true);
		});

		it('does not post-process when there are no collected vars', async () => {


			const shouldProcess = await shouldPostProcessFrontMatter(mockFile, new Map());
			expect(shouldProcess).toBe(false);
			expect(mockFileManager.processFrontMatter).not.toHaveBeenCalled();
		});

		it('should post-process when flag is enabled', async () => {
			mockPlugin.settings.enableTemplatePropertyTypes = true;


			const templateVars = new Map<string, unknown>([['title', 'Test'], ['count', 42]]);

			await postProcessFrontMatter(mockApp, mockFile, templateVars);
			expect(mockFileManager.processFrontMatter).toHaveBeenCalledOnce();
		});

		it('should clear templatePropertyVars after each run', async () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);

			formatter.setVariable('test1', 42); // Use number to ensure tracking
			await formatter.formatContent('prop: {{test1}}');

			let vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.size).toBe(1);
			expect(vars.get('prop')).toBe(42);

			// Second run should start clean
			formatter.setVariable('test2', true); // Use boolean to ensure tracking
			await formatter.formatContent('other: {{test2}}');

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


			const templateVars = new Map<string, unknown>([['title', 'Test']]);

			// Should not throw, file should still be considered created
			await expect(postProcessFrontMatter(mockApp, mockFile, templateVars)).resolves.toBeUndefined();
			expect(log.logError).toHaveBeenCalledWith(
				expect.stringContaining('Failed to post-process front matter')
			);
		});

		it('should handle malformed template variables gracefully', async () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			const malformedTemplate = 'title: {{UNCLOSED_VAR\nother: {{}}';

			formatter.setVariable('UNCLOSED_VAR', 'test');

			// Should not throw, should handle gracefully
			await expect(formatter.formatContent(malformedTemplate)).resolves.toBeDefined();
		});

		it('should handle circular references in objects', async () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);
			const circularObj: any = { name: 'test' };
			circularObj.self = circularObj;

			formatter.setVariable('circular', circularObj);

			// Should not throw or hang
			await expect(formatter.formatContent('data: {{circular}}')).resolves.toBeDefined();

			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.has('data')).toBe(true);
		});

		it('should handle very large data structures', async () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);

			// Create large array
			const largeArray = new Array(10000).fill(0).map((_, i) => ({ id: i, data: `item-${i}` }));
			formatter.setVariable('bigData', largeArray);

			await formatter.formatContent('items: {{bigData}}');

			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.get('items')).toBe(largeArray);
		});

		itPerf('formats very large data structures within budget', async () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);

			const largeArray = new Array(10000).fill(0).map((_, i) => ({ id: i, data: `item-${i}` }));
			formatter.setVariable('bigData', largeArray);

			const start = performance.now();
			await formatter.formatContent('items: {{bigData}}');
			const duration = performance.now() - start;

			expect(duration).toBeLessThan(1000);
		});

		it('should handle undefined and null values properly', async () => {
			const collector = new TemplatePropertyCollector();
			for (const [key, rawValue] of Object.entries({ null: null, undef: undefined, empty: "" })) {
				const input = `---\n${key}: {{VALUE:value}}\n---`;
				const matchStart = input.indexOf("{{");
				collector.maybeCollect({ input, matchStart, matchEnd: input.indexOf("}}") + 2,
					rawValue, fallbackKey: key, collectionActive: true, heuristicEnabled: true });
			}
			const vars = collector.drain();
			expect(vars.get("null")).toBe(null);
			expect(vars.has("undef")).toBe(false);
			expect(vars.has("empty")).toBe(false);
		});
	});

	describe('Edge Cases', () => {
		it('should handle multiple variables mapping to same YAML key', async () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);

			formatter.setVariable('first', 42);
			formatter.setVariable('second', 100);

			// Same property key used twice
			await formatter.formatContent('count: {{first}}\ncount: {{second}}');

			const vars = formatter.getAndClearTemplatePropertyVars();
			// Last one should win
			expect(vars.get('count')).toBe(100);
			expect(vars.size).toBe(1);
		});

		it('should handle special characters in property names and values', async () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);

			const specialObject = { special: '特殊文字 & symbols: @#$%^&*()' };
			formatter.setVariable('special', specialObject);

			await formatter.formatContent('my-special_prop123: {{special}}');

			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.get('my-special_prop123')).toBe(specialObject);
		});

		it('should handle Unicode properly', async () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);

			const unicodeObject = { text: '🎉 测试 العربية ñ' };
			formatter.setVariable('unicode', unicodeObject);

			await formatter.formatContent('title: {{unicode}}');

			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.get('title')).toBe(unicodeObject);
		});

		it('should handle nested objects and arrays', async () => {
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
			await formatter.formatContent('data: {{complex}}');

			const vars = formatter.getAndClearTemplatePropertyVars();
			expect(vars.get('data')).toEqual(complexData);
		});

		it('should only process markdown files for front matter', async () => {

			const templateVars = new Map<string, unknown>([['title', 'Test']]);

			// Test with canvas file
			const canvasFile = { ...mockFile, extension: 'canvas' } as TFile;
			const shouldProcessCanvas = await shouldPostProcessFrontMatter(canvasFile, templateVars);
			expect(shouldProcessCanvas).toBe(false);

			// Test with markdown file
			const mdFile = { ...mockFile, extension: 'md' } as TFile;
			const shouldProcessMd = await shouldPostProcessFrontMatter(mdFile, templateVars);
			expect(shouldProcessMd).toBe(true);
		});

		it('should not process when no template variables collected', async () => {

			const emptyVars = new Map<string, unknown>();

			const shouldProcess = await shouldPostProcessFrontMatter(mockFile, emptyVars);
			expect(shouldProcess).toBe(false);
		});
	});

	describe('State Management', () => {
		it('should prevent cross-contamination between multiple template runs', async () => {
			const formatter1 = new TestFormatter(mockApp, mockPlugin);
			const formatter2 = new TestFormatter(mockApp, mockPlugin);

			// Run 1
			formatter1.setVariable('var1', 42);
			await formatter1.formatContent('prop1: {{var1}}');

			// Run 2 (different formatter instance)
			formatter2.setVariable('var2', true);
			await formatter2.formatContent('prop2: {{var2}}');

			const vars1 = formatter1.getAndClearTemplatePropertyVars();
			const vars2 = formatter2.getAndClearTemplatePropertyVars();

			expect(vars1.size).toBe(1);
			expect(vars1.get('prop1')).toBe(42);
			expect(vars1.has('prop2')).toBe(false);

			expect(vars2.size).toBe(1);
			expect(vars2.get('prop2')).toBe(true);
			expect(vars2.has('prop1')).toBe(false);
		});

		it('should handle memory properly for large variable maps', async () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);

			// Create many variables
			for (let i = 0; i < 1000; i++) {
				formatter.setVariable(`var${i}`, { data: `value${i}` });
			}

			let template = '';
			for (let i = 0; i < 1000; i++) {
				template += `prop${i}: {{var${i}}}\n`;
			}

			await formatter.formatContent(template);
			const vars = formatter.getAndClearTemplatePropertyVars();

			expect(vars.size).toBe(1000);

			// After clearing, should be empty
			const clearedVars = formatter.getAndClearTemplatePropertyVars();
			expect(clearedVars.size).toBe(0);
		});

		itPerf('formats large variable maps within budget', async () => {
			const formatter = new TestFormatter(mockApp, mockPlugin);

			for (let i = 0; i < 1000; i++) {
				formatter.setVariable(`var${i}`, { data: `value${i}` });
			}

			let template = '';
			for (let i = 0; i < 1000; i++) {
				template += `prop${i}: {{var${i}}}\n`;
			}

			const start = performance.now();
			await formatter.formatContent(template);
			const duration = performance.now() - start;

			expect(duration).toBeLessThan(2000);
		});
	});
});


class TestFormatter {
	private readonly executor = createChoiceExecutor();
	private readonly formatter: CompleteFormatter;
	constructor(app: App, plugin: QuickAdd) {
		this.formatter = new CompleteFormatter(app, plugin, this.executor);
	}
	setVariable(name: string, value: unknown) {
		this.executor.variables.set(name, value);
	}
	getAndClearTemplatePropertyVars() {
		return this.formatter.getAndClearTemplatePropertyVars();
	}
	async formatContent(properties: string) {
		const template = `---\n${properties.replace(/\{\{([^}]+)\}\}/g, "{{VALUE:$1}}") }\n---`;
		const formatted = await this.formatter.withTemplatePropertyCollection(() =>
			this.formatter.formatFileContent(template));
		return formatted.slice(4, -4);
	}
}
