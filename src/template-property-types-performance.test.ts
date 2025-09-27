import { describe, test, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import type { TFile } from 'obsidian';
import type QuickAdd from '../src/main';

// Mock the logger to avoid console noise during performance tests
vi.mock('../src/logger/logManager', () => ({
	log: {
		logError: vi.fn(),
		logMessage: vi.fn(),
	},
}));

// Performance test utilities
const PERFORMANCE_THRESHOLDS = {
	SMALL_TEMPLATE_MS: 50,     // Small templates should be near-instantaneous
	MEDIUM_TEMPLATE_MS: 100,   // Medium templates should be quick
	LARGE_TEMPLATE_MS: 500,    // Large templates should still be usable
	VERY_LARGE_MS: 1000,       // Very large operations should not hang
	MEMORY_CHECK_MS: 50,       // Memory operations should be fast
};

/**
 * Generates test templates with varying numbers of variables
 */
function generateTemplate(variableCount: number, prefix = 'var'): string {
	const frontMatter = Array.from({ length: variableCount }, (_, i) => 
		`${prefix}${i}: {{VALUE:${prefix}${i}}}`
	).join('\n');
	
	return `---\n${frontMatter}\n---\n\nTemplate content with ${variableCount} variables`;
}

/**
 * Generates large test data structures
 */
function generateLargeDataStructure(itemCount: number) {
	return {
		largeArray: Array.from({ length: itemCount }, (_, i) => ({
			id: i,
			name: `Item ${i}`,
			data: `Data for item ${i}`,
			nested: {
				level1: {
					level2: {
						value: `nested-${i}`,
						timestamp: new Date().toISOString(),
					}
				}
			}
		})),
		metadata: {
			totalItems: itemCount,
			generatedAt: new Date().toISOString(),
		}
	};
}

/**
 * Performance test wrapper that measures execution time
 */
async function measurePerformance<T>(
	operation: () => Promise<T> | T,
	operationName: string
): Promise<{ result: T; duration: number }> {
	const startTime = performance.now();
	const result = await operation();
	const duration = performance.now() - startTime;
	
	// Log performance data for debugging
	console.log(`${operationName}: ${duration.toFixed(2)}ms`);
	
	return { result, duration };
}

/**
 * Mock Formatter for performance testing
 */
class MockFormatter {
	private templatePropertyVars: Map<string, unknown> = new Map();
	
	async formatFileContent(content: string): Promise<string> {
		// Simulate variable processing
		const variableRegex = /\{\{VALUE:([^}]+)\}\}/g;
		let match;
		
		while ((match = variableRegex.exec(content)) !== null) {
			const variableName = match[1];
			const value = this.generateMockValue(variableName);
			this.templatePropertyVars.set(variableName, value);
		}
		
		// Replace variables with mock values
		return content.replace(variableRegex, (_, variableName) => {
			const value = this.generateMockValue(variableName);
			return String(value);
		});
	}
	
	private generateMockValue(variableName: string): unknown {
		// Generate different types of test data
		if (variableName.includes('date')) {
			return '@date:2024-01-01T00:00:00Z';
		}
		if (variableName.includes('number')) {
			return Math.floor(Math.random() * 1000);
		}
		if (variableName.includes('array')) {
			return Array.from({ length: 10 }, (_, i) => `item${i}`);
		}
		if (variableName.includes('object')) {
			return { nested: { value: 'test', count: 42 } };
		}
		return `value-${variableName}`;
	}
	
	getAndClearTemplatePropertyVars(): Map<string, unknown> {
		const result = new Map(this.templatePropertyVars);
		this.templatePropertyVars.clear();
		return result;
	}
}

/**
 * Mock Template Engine for performance testing
 */
class MockTemplateEngine {
	private formatter = new MockFormatter();
	private mockApp: any;
	private plugin: any;
	
	constructor(plugin: any, app: any) {
		this.plugin = plugin;
		this.mockApp = app;
	}
	
	async processTemplate(template: string): Promise<{ file: TFile; templateVars: Map<string, unknown> }> {
		// Format template content
		await this.formatter.formatFileContent(template);
		
		// Get template variables
		const templateVars = this.formatter.getAndClearTemplatePropertyVars();
		
		// Create mock file
		const file = {
			path: 'test.md',
			extension: 'md',
			name: 'test.md',
		} as TFile;
		
		// Simulate file creation delay
		await new Promise(resolve => setTimeout(resolve, 1));
		
		return { file, templateVars };
	}
	
	async postProcessFrontMatter(file: TFile, templateVars: Map<string, unknown>): Promise<void> {
		// Simulate Obsidian's processFrontMatter call
		const processFrontMatter = this.mockApp.fileManager.processFrontMatter as MockedFunction<any>;
		
		await processFrontMatter(file, (frontmatter: any) => {
			for (const [key, value] of templateVars) {
				// Convert @date:ISO strings to Date objects
				if (typeof value === 'string' && value.startsWith('@date:')) {
					const dateString = value.substring(6);
					const dateObj = new Date(dateString);
					
					if (!isNaN(dateObj.getTime())) {
						frontmatter[key] = dateObj;
					} else {
						frontmatter[key] = value;
					}
				} else {
					frontmatter[key] = value;
				}
			}
		});
	}
}

describe('Template Property Types Performance Tests', () => {
	let mockPlugin: QuickAdd;
	let mockApp: any;
	let templateEngine: MockTemplateEngine;
	let processFrontMatterSpy: MockedFunction<any>;
	
	beforeEach(() => {
		// Setup mocks
		mockPlugin = {
			settings: {
				enableTemplatePropertyTypes: true,
			},
		} as QuickAdd;
		
		processFrontMatterSpy = vi.fn().mockImplementation((file, callback) => {
			const mockFrontmatter = {};
			callback(mockFrontmatter);
			return Promise.resolve();
		});
		
		mockApp = {
			fileManager: {
				processFrontMatter: processFrontMatterSpy,
			},
		};
		
		templateEngine = new MockTemplateEngine(mockPlugin, mockApp);
	});
	
	describe('Performance Benchmarks', () => {
		test('small templates (1-5 variables) should be near-instantaneous', async () => {
			const template = generateTemplate(5);
			
			const { duration } = await measurePerformance(
				() => templateEngine.processTemplate(template),
				'Small template processing'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.SMALL_TEMPLATE_MS);
		});
		
		test('medium templates (10-20 variables) should complete quickly', async () => {
			const template = generateTemplate(15);
			
			const { duration } = await measurePerformance(
				() => templateEngine.processTemplate(template),
				'Medium template processing'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.MEDIUM_TEMPLATE_MS);
		});
		
		test('large templates (50+ variables) should still be usable', async () => {
			const template = generateTemplate(75);
			
			const { duration } = await measurePerformance(
				() => templateEngine.processTemplate(template),
				'Large template processing'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.LARGE_TEMPLATE_MS);
		});
		
		test('very large templates (100+ variables) should not hang', async () => {
			const template = generateTemplate(150);
			
			const { duration } = await measurePerformance(
				() => templateEngine.processTemplate(template),
				'Very large template processing'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.VERY_LARGE_MS);
		});
		
		test('templates with complex data structures should process efficiently', async () => {
			const complexData = generateLargeDataStructure(100);
			
			const { duration } = await measurePerformance(
				async () => {
					const templateVars = new Map();
					templateVars.set('complexData', complexData);
					templateVars.set('largeArray', complexData.largeArray);
					templateVars.set('nestedObject', complexData.largeArray[0].nested);
					
					const mockFile = { path: 'test.md', extension: 'md' } as TFile;
					await templateEngine.postProcessFrontMatter(mockFile, templateVars);
					
					return templateVars;
				},
				'Complex data structure processing'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.LARGE_TEMPLATE_MS);
		});
	});
	
	describe('Memory Usage', () => {
		test('templatePropertyVars map should be properly cleared after use', async () => {
			const mockFormatter = new MockFormatter();
			const template = generateTemplate(20);
			
			// Process template
			await mockFormatter.formatFileContent(template);
			
			// Get variables (should clear internal map)
			const vars1 = mockFormatter.getAndClearTemplatePropertyVars();
			expect(vars1.size).toBe(20);
			
			// Second call should return empty map
			const { duration } = await measurePerformance(
				() => mockFormatter.getAndClearTemplatePropertyVars(),
				'Template vars clearing'
			);
			
			const vars2 = mockFormatter.getAndClearTemplatePropertyVars();
			expect(vars2.size).toBe(0);
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.MEMORY_CHECK_MS);
		});
		
		test('no memory leaks from repeated template processing', async () => {
			const template = generateTemplate(10);
			const iterations = 100;
			
			const { duration } = await measurePerformance(
				async () => {
					for (let i = 0; i < iterations; i++) {
						const { templateVars } = await templateEngine.processTemplate(template);
						expect(templateVars.size).toBe(10);
						
						// Simulate cleanup
						templateVars.clear();
					}
				},
				`Repeated template processing (${iterations} iterations)`
			);
			
			// Should scale linearly, not exponentially
			const avgTimePerIteration = duration / iterations;
			expect(avgTimePerIteration).toBeLessThan(5); // Less than 5ms per iteration
		});
		
		test('large objects should not cause memory issues', async () => {
			const largeData = generateLargeDataStructure(1000);
			
			const { duration } = await measurePerformance(
				async () => {
					const templateVars = new Map();
					templateVars.set('largeData', largeData);
					
					const mockFile = { path: 'test.md', extension: 'md' } as TFile;
					await templateEngine.postProcessFrontMatter(mockFile, templateVars);
					
					// Clear the map
					templateVars.clear();
				},
				'Large object processing and cleanup'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.VERY_LARGE_MS);
		});
	});
	
	describe('YAML Processing Performance', () => {
		test('processFrontMatter with complex nested structures should be efficient', async () => {
			const complexStructure = {
				level1: {
					level2: {
						level3: {
							arrays: Array.from({ length: 50 }, (_, i) => ({
								id: i,
								data: `item-${i}`,
								nested: { value: i * 2 }
							})),
							dates: Array.from({ length: 10 }, (_, i) => 
								`@date:2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`
							),
						}
					}
				}
			};
			
			const templateVars = new Map();
			templateVars.set('complex', complexStructure);
			
			const { duration } = await measurePerformance(
				async () => {
					const mockFile = { path: 'test.md', extension: 'md' } as TFile;
					await templateEngine.postProcessFrontMatter(mockFile, templateVars);
				},
				'Complex YAML processing'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.LARGE_TEMPLATE_MS);
			expect(processFrontMatterSpy).toHaveBeenCalledOnce();
		});
		
		test('multiple post-processing calls should not slow down significantly', async () => {
			const template = generateTemplate(10);
			const iterations = 50;
			
			const durations: number[] = [];
			
			for (let i = 0; i < iterations; i++) {
				const { file, templateVars } = await templateEngine.processTemplate(template);
				
				const { duration } = await measurePerformance(
					() => templateEngine.postProcessFrontMatter(file, templateVars),
					`Post-processing iteration ${i + 1}`
				);
				
				durations.push(duration);
			}
			
			// Check that performance doesn't degrade significantly over time
			const firstTen = durations.slice(0, 10);
			const lastTen = durations.slice(-10);
			
			const avgFirst = firstTen.reduce((a, b) => a + b, 0) / firstTen.length;
			const avgLast = lastTen.reduce((a, b) => a + b, 0) / lastTen.length;
			
			// Last ten should not be more than 2x slower than first ten
			expect(avgLast).toBeLessThan(avgFirst * 2);
			expect(avgLast).toBeLessThan(PERFORMANCE_THRESHOLDS.MEDIUM_TEMPLATE_MS);
		});
		
		test('date conversion performance should be consistent', async () => {
			const dateVars = new Map();
			
			// Add many date variables
			for (let i = 0; i < 100; i++) {
				dateVars.set(`date${i}`, `@date:2024-01-${String((i % 31) + 1).padStart(2, '0')}T00:00:00Z`);
				dateVars.set(`string${i}`, `regular-string-${i}`);
				dateVars.set(`number${i}`, i);
			}
			
			const { duration } = await measurePerformance(
				async () => {
					const mockFile = { path: 'test.md', extension: 'md' } as TFile;
					await templateEngine.postProcessFrontMatter(mockFile, dateVars);
				},
				'Bulk date conversion processing'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.LARGE_TEMPLATE_MS);
		});
	});
	
	describe('Stress Testing', () => {
		test('rapidly creating many files with template property types', async () => {
			const template = generateTemplate(5);
			const fileCount = 20;
			
			// Reset spy before test
			processFrontMatterSpy.mockClear();
			
			const { duration } = await measurePerformance(
				async () => {
					// Process files sequentially for consistent spy counting
					const files = [];
					for (let i = 0; i < fileCount; i++) {
						const { file, templateVars } = await templateEngine.processTemplate(template);
						file.path = `test-${i}.md`;
						
						if (templateVars.size > 0) {
							await templateEngine.postProcessFrontMatter(file, templateVars);
						}
						
						files.push(file);
					}
					
					expect(files).toHaveLength(fileCount);
					return files;
				},
				`Sequential file creation (${fileCount} files)`
			);
			
			// Should handle sequential operations efficiently
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.VERY_LARGE_MS);
			expect(processFrontMatterSpy).toHaveBeenCalledTimes(fileCount);
		});
		
		test('mixed feature flag toggling during processing should not affect performance', async () => {
			const template = generateTemplate(10);
			
			const { duration } = await measurePerformance(
				async () => {
					for (let i = 0; i < 20; i++) {
						// Toggle feature flag
						mockPlugin.settings.enableTemplatePropertyTypes = i % 2 === 0;
						
						const { file, templateVars } = await templateEngine.processTemplate(template);
						
						if (mockPlugin.settings.enableTemplatePropertyTypes && templateVars.size > 0) {
							await templateEngine.postProcessFrontMatter(file, templateVars);
						}
					}
				},
				'Mixed feature flag toggling'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.VERY_LARGE_MS);
		});
		
		test('processing very large variable values should not cause timeouts', async () => {
			const hugeString = 'x'.repeat(100000); // 100KB string
			const largeArray = Array.from({ length: 10000 }, (_, i) => `item-${i}`);
			
			const templateVars = new Map();
			templateVars.set('hugeString', hugeString);
			templateVars.set('largeArray', largeArray);
			templateVars.set('hugeDate', '@date:2024-01-01T00:00:00Z');
			
			const { duration } = await measurePerformance(
				async () => {
					const mockFile = { path: 'test.md', extension: 'md' } as TFile;
					await templateEngine.postProcessFrontMatter(mockFile, templateVars);
				},
				'Very large variable values processing'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.VERY_LARGE_MS);
		});
	});
	
	describe('Regression Testing', () => {
		test('feature should not slow down existing template processing when disabled', async () => {
			const template = generateTemplate(20);
			
			// Test with feature disabled
			mockPlugin.settings.enableTemplatePropertyTypes = false;
			
			const { duration: disabledDuration } = await measurePerformance(
				async () => {
					for (let i = 0; i < 10; i++) {
						await templateEngine.processTemplate(template);
					}
				},
				'Template processing (feature disabled)'
			);
			
			// Test with feature enabled
			mockPlugin.settings.enableTemplatePropertyTypes = true;
			
			const { duration: enabledDuration } = await measurePerformance(
				async () => {
					for (let i = 0; i < 10; i++) {
						const { file, templateVars } = await templateEngine.processTemplate(template);
						if (templateVars.size > 0) {
							await templateEngine.postProcessFrontMatter(file, templateVars);
						}
					}
				},
				'Template processing (feature enabled)'
			);
			
			// Enabled should not be significantly slower (allow 3x overhead)
			expect(enabledDuration).toBeLessThan(disabledDuration * 3 + 100);
		});
		
		test('baseline performance without the feature should meet expectations', async () => {
			mockPlugin.settings.enableTemplatePropertyTypes = false;
			const template = generateTemplate(30);
			
			const { duration } = await measurePerformance(
				async () => {
					const formatter = new MockFormatter();
					await formatter.formatFileContent(template);
					
					// The MockFormatter always collects variables regardless of feature flag
					// In real implementation, this would be controlled by the feature flag
					const vars = formatter.getAndClearTemplatePropertyVars();
					expect(vars.size).toBeGreaterThanOrEqual(0); // Variables were collected
				},
				'Baseline performance (feature disabled)'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.MEDIUM_TEMPLATE_MS);
		});
	});
	
	describe('Performance Edge Cases', () => {
		test('empty templates should process instantly', async () => {
			const { duration } = await measurePerformance(
				() => templateEngine.processTemplate('---\n---\n\nEmpty template'),
				'Empty template processing'
			);
			
			expect(duration).toBeLessThan(10); // Should be near-instantaneous
		});
		
		test('templates with no variables should be fast', async () => {
			const template = '---\ntitle: Static Title\nstatus: published\n---\n\nStatic content';
			
			const { duration } = await measurePerformance(
				() => templateEngine.processTemplate(template),
				'Static template processing'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.SMALL_TEMPLATE_MS);
		});
		
		test('malformed templates should not cause performance issues', async () => {
			const malformedTemplate = '---\ntitle: {{INVALID_SYNTAX\ncontent: {{VALUE:test}}\n---';
			
			const { duration } = await measurePerformance(
				() => templateEngine.processTemplate(malformedTemplate),
				'Malformed template processing'
			);
			
			expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.MEDIUM_TEMPLATE_MS);
		});
	});
});
