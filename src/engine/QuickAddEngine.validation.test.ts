import { describe, it, expect, beforeEach } from 'vitest';
import type { App } from 'obsidian';
import { QuickAddEngine } from './QuickAddEngine';

/**
 * Test implementation of QuickAddEngine for validation testing
 */
class TestQuickAddEngine extends QuickAddEngine {
	constructor(app: App) {
		super(app);
	}

	public run(): void {
		// Not needed for validation tests
	}

	// Expose protected method for testing
	public testValidateStructuredVariables(vars: Map<string, unknown>) {
		return this.validateStructuredVariables(vars);
	}
}

describe('QuickAddEngine - Structured Variable Validation', () => {
	let mockApp: App;
	let engine: TestQuickAddEngine;

	beforeEach(() => {
		mockApp = {} as App;
		engine = new TestQuickAddEngine(mockApp);
	});

	describe('Valid variables', () => {
		it('should validate simple primitives', () => {
			const vars = new Map<string, unknown>([
				['string', 'test'],
				['number', 42],
				['boolean', true],
				['null', null],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.warnings).toHaveLength(0);
		});

		it('should validate arrays', () => {
			const vars = new Map<string, unknown>([
				['simpleArray', [1, 2, 3]],
				['stringArray', ['a', 'b', 'c']],
				['mixedArray', [1, 'two', true, null]],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should validate objects', () => {
			const vars = new Map<string, unknown>([
				['simpleObject', { name: 'test', age: 30 }],
				['nestedObject', { user: { name: 'test', active: true } }],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should validate date strings with @date: prefix', () => {
			const vars = new Map<string, unknown>([
				['dateString', '@date:2024-01-15T10:30:00.000Z'],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});
	});

	describe('Invalid types', () => {
		it('should reject functions', () => {
			const vars = new Map<string, unknown>([
				['func', () => {}],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain('func');
			expect(result.errors[0]).toContain('function');
		});

		it('should reject symbols', () => {
			const vars = new Map<string, unknown>([
				['sym', Symbol('test')],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain('sym');
			expect(result.errors[0]).toContain('symbol');
		});

		it('should warn about BigInt', () => {
			const vars = new Map<string, unknown>([
				['bigNum', BigInt(123)],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(true); // Warning, not error
			expect(result.warnings).toHaveLength(1);
			expect(result.warnings[0]).toContain('bigNum');
			expect(result.warnings[0]).toContain('BigInt');
		});

		it('should reject functions nested in objects', () => {
			const vars = new Map<string, unknown>([
				['obj', { data: 'test', callback: () => {} }],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain('obj.callback');
			expect(result.errors[0]).toContain('function');
		});
	});

	describe('Circular references', () => {
		it('should detect circular reference in object', () => {
			const circular: any = { name: 'test' };
			circular.self = circular;

			const vars = new Map<string, unknown>([
				['circular', circular],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain('circular');
			expect(result.errors[0]).toContain('circular reference');
		});

		it('should detect circular reference in nested object', () => {
			const obj1: any = { name: 'obj1' };
			const obj2: any = { name: 'obj2', parent: obj1 };
			obj1.child = obj2;

			const vars = new Map<string, unknown>([
				['nested', obj1],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.errors[0]).toContain('circular reference');
		});

		it('should detect circular reference in array', () => {
			const arr: any[] = [1, 2, 3];
			arr.push(arr);

			const vars = new Map<string, unknown>([
				['arrayCircular', arr],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(false);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]).toContain('circular reference');
		});
	});

	describe('Nesting depth limits', () => {
		it('should accept nesting within limits', () => {
			// Create object with nesting depth of 5 (well within limit of 10)
			const deepObj = {
				level1: {
					level2: {
						level3: {
							level4: {
								level5: { value: 'deep' }
							}
						}
					}
				}
			};

			const vars = new Map<string, unknown>([
				['deepObj', deepObj],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should reject excessive nesting depth', () => {
			// Create object with nesting depth exceeding limit
			let deepObj: any = { value: 'bottom' };
			for (let i = 0; i < 12; i++) {
				deepObj = { nested: deepObj };
			}

			const vars = new Map<string, unknown>([
				['tooDeep', deepObj],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.errors[0]).toContain('nesting depth');
			expect(result.errors[0]).toContain('10');
		});

		it('should reject excessive nesting in arrays', () => {
			// Create array with excessive nesting
			let deepArr: any = ['bottom'];
			for (let i = 0; i < 12; i++) {
				deepArr = [deepArr];
			}

			const vars = new Map<string, unknown>([
				['deepArray', deepArr],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(false);
			expect(result.errors.length).toBeGreaterThan(0);
			expect(result.errors[0]).toContain('nesting depth');
		});
	});

	describe('Multiple issues', () => {
		it('should report multiple errors from different variables', () => {
			const circular: any = { name: 'test' };
			circular.self = circular;

			const vars = new Map<string, unknown>([
				['circular', circular],
				['func', () => {}],
				['sym', Symbol('test')],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(false);
			expect(result.errors.length).toBeGreaterThanOrEqual(3);
		});

		it('should report multiple issues in the same object', () => {
			const problematic = {
				callback: () => {},
				id: Symbol('id'),
				bigNumber: BigInt(999),
			};

			const vars = new Map<string, unknown>([
				['problematic', problematic],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(false);
			expect(result.errors.length).toBeGreaterThanOrEqual(2); // function and symbol
			expect(result.warnings).toHaveLength(1); // BigInt
		});
	});

	describe('Edge cases', () => {
		it('should handle empty Map', () => {
			const vars = new Map<string, unknown>();

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
			expect(result.warnings).toHaveLength(0);
		});

		it('should handle undefined and null values', () => {
			const vars = new Map<string, unknown>([
				['undef', undefined],
				['nullVal', null],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should handle Date objects', () => {
			const vars = new Map<string, unknown>([
				['date', new Date('2024-01-15')],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});

		it('should handle objects with Date properties', () => {
			const vars = new Map<string, unknown>([
				['event', { name: 'Meeting', date: new Date('2024-01-15'), attendees: ['Alice', 'Bob'] }],
			]);

			const result = engine.testValidateStructuredVariables(vars);

			expect(result.isValid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});
	});
});