import { describe, expect, it } from 'vitest';
import { parseStructuredPropertyValueFromString, splitTopLevel } from './templatePropertyStringParser';

describe('templatePropertyStringParser', () => {
	it('parses comma-separated values into an array', () => {
		const input = 'tag1, tag2, awesomeproject';
		const result = parseStructuredPropertyValueFromString(input);
		expect(result).toEqual(['tag1', 'tag2', 'awesomeproject']);
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
		expect(result).toBeNull();
	});

	it('parses JSON arrays', () => {
		const result = parseStructuredPropertyValueFromString('["tag1", "tag2"]');
		expect(result).toEqual(['tag1', 'tag2']);
	});
});
