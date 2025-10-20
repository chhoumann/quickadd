import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { parseStructuredPropertyValueFromString, splitTopLevel } from './templatePropertyStringParser';

const createMockApp = (typeMap: Record<string, string>): App => {
	return {
		metadataCache: {
			app: {
				metadataTypeManager: {
					getTypeInfo: (key: string) => ({ expected: { type: typeMap[key] } }),
				},
			},
		},
	} as unknown as App;
};

describe('templatePropertyStringParser', () => {
	it('parses comma-separated values into an array', () => {
		const input = 'tag1, tag2, awesomeproject';
		const app = createMockApp({ projects: 'multitext' });
		const result = parseStructuredPropertyValueFromString(input, { propertyKey: 'projects', app });
		expect(result).toEqual(['tag1', 'tag2', 'awesomeproject']);
	});

	it('leaves comma-containing text alone for scalar properties', () => {
		const input = 'Hello, world';
		const app = createMockApp({ description: 'text' });
		const result = parseStructuredPropertyValueFromString(input, { propertyKey: 'description', app });
		expect(result).toBeUndefined();
	});

	it('parses YAML bullet lists', () => {
		const input = '- project1\n- project2';
		const result = parseStructuredPropertyValueFromString(input);
		expect(result).toEqual(['project1', 'project2']);
	});

	it('parses literal \n sequences in bullet lists', () => {
		const input = '- project1\\n- project2';
		const result = parseStructuredPropertyValueFromString(input);
		expect(result).toEqual(['project1', 'project2']);
	});

	it('ignores commas inside wiki links when splitting', () => {
		const segments = splitTopLevel('[[test, a]], [[another|alias, value]], plain');
		expect(segments).toEqual(['[[test, a]]', '[[another|alias, value]]', 'plain']);
	});

	it('does not treat single wiki links as arrays', () => {
		const result = parseStructuredPropertyValueFromString('[[test, a]]');
		expect(result).toBeUndefined();
	});

	it('parses JSON arrays', () => {
		const result = parseStructuredPropertyValueFromString('["tag1", "tag2"]');
		expect(result).toEqual(['tag1', 'tag2']);
	});

	it('splitTopLevel handles escaped quotes within quoted segments', () => {
		const segments = splitTopLevel('"value with \\"quote\\" inside", "second"');
		const expectedFirst = "\"value with \\\"quote\\\" inside\"";
		expect(segments).toEqual([expectedFirst, '"second"']);
	});

	describe('primitive type parsing', () => {
		it('parses boolean true', () => {
			const result = parseStructuredPropertyValueFromString('true');
			expect(result).toBe(true);
		});

		it('parses boolean false', () => {
			const result = parseStructuredPropertyValueFromString('false');
			expect(result).toBe(false);
		});

		it('parses null', () => {
			const result = parseStructuredPropertyValueFromString('null');
			expect(result).toBe(null);
		});

		it('parses positive integer', () => {
			const result = parseStructuredPropertyValueFromString('42');
			expect(result).toBe(42);
		});

		it('parses negative integer', () => {
			const result = parseStructuredPropertyValueFromString('-42');
			expect(result).toBe(-42);
		});

		it('parses zero', () => {
			const result = parseStructuredPropertyValueFromString('0');
			expect(result).toBe(0);
		});

		it('parses positive float', () => {
			const result = parseStructuredPropertyValueFromString('3.14');
			expect(result).toBe(3.14);
		});

		it('parses negative float', () => {
			const result = parseStructuredPropertyValueFromString('-3.14');
			expect(result).toBe(-3.14);
		});

		it('parses scientific notation', () => {
			const result = parseStructuredPropertyValueFromString('1e10');
			expect(result).toBe(1e10);
		});

		it('parses negative scientific notation', () => {
			const result = parseStructuredPropertyValueFromString('-1.5e-10');
			expect(result).toBe(-1.5e-10);
		});

		it('does not parse number-like strings with extra text', () => {
			expect(parseStructuredPropertyValueFromString('42nd')).toBeUndefined();
			expect(parseStructuredPropertyValueFromString('3.14.15')).toBeUndefined();
			expect(parseStructuredPropertyValueFromString('123abc')).toBeUndefined();
		});

		it('does not parse multi-line primitive values', () => {
			expect(parseStructuredPropertyValueFromString('true\nfalse')).toBeUndefined();
			expect(parseStructuredPropertyValueFromString('42\n43')).toBeUndefined();
		});

		it('handles whitespace around primitive values', () => {
			expect(parseStructuredPropertyValueFromString('  true  ')).toBe(true);
			expect(parseStructuredPropertyValueFromString('\t42\t')).toBe(42);
			expect(parseStructuredPropertyValueFromString(' null ')).toBe(null);
		});

		it('does not parse string "True" with capital T', () => {
			expect(parseStructuredPropertyValueFromString('True')).toBeUndefined();
			expect(parseStructuredPropertyValueFromString('FALSE')).toBeUndefined();
		});
	});
});
