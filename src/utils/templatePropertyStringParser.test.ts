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
});
