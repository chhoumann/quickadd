import { describe, it, expect } from 'vitest';
import {
	getVariableExample,
	getMacroPreview,
	getVariablePromptExample,
	getSuggestionPreview,
	getCurrentFileLinkPreview,
	DateFormatPreviewGenerator
} from './previewHelpers';

describe('PreviewHelpers', () => {
	describe('getVariableExample', () => {
		it('should return predefined examples for known variables', () => {
			expect(getVariableExample('title')).toBe('My Document Title');
			expect(getVariableExample('project')).toBe('Project Alpha');
			expect(getVariableExample('TITLE')).toBe('My Document Title'); // case insensitive
		});

		it('should return generic example for unknown variables', () => {
			expect(getVariableExample('unknown')).toBe('unknown_example');
		});
	});

	describe('getMacroPreview', () => {
		it('should return descriptive previews for known macros', () => {
			expect(getMacroPreview('clipboard')).toBe('clipboard_content');
			expect(getMacroPreview('UUID')).toBe('unique_id'); // case insensitive
		});

		it('should return generic preview for unknown macros', () => {
			expect(getMacroPreview('custom')).toBe('custom_output');
		});
	});

	describe('getVariablePromptExample', () => {
		it('should match patterns and return appropriate examples', () => {
			expect(getVariablePromptExample('date')).toBe('2024-01-15');
			expect(getVariablePromptExample('title')).toBe('Example Title');
			expect(getVariablePromptExample('tag')).toBe('important');
			expect(getVariablePromptExample('priority')).toBe('High');
		});

		it('should return generic example for unmatched patterns', () => {
			expect(getVariablePromptExample('custom')).toBe('custom_value');
		});
	});

	describe('getSuggestionPreview', () => {
		it('should show first option with count for non-empty arrays', () => {
			const suggestions = ['option1', 'option2', 'option3'];
			expect(getSuggestionPreview(suggestions)).toBe('option1 (3 options)');
		});

		it('should show single option with count', () => {
			const suggestions = ['single'];
			expect(getSuggestionPreview(suggestions)).toBe('single (1 options)');
		});

		it('should return generic preview for empty arrays', () => {
			expect(getSuggestionPreview([])).toBe('suggestion_list');
		});
	});

	describe('getCurrentFileLinkPreview', () => {
		it('should return basename for files with path', () => {
			const file = { basename: 'example', path: 'folder/example.md' };
			expect(getCurrentFileLinkPreview(file)).toBe('example');
		});

		it('should return generic preview for files without path', () => {
			const file = { basename: 'example', path: '' };
			expect(getCurrentFileLinkPreview(file as any)).toBe('current_file');
		});

		it('should return generic preview for null/undefined', () => {
			expect(getCurrentFileLinkPreview(null)).toBe('current_file');
			expect(getCurrentFileLinkPreview(undefined)).toBe('current_file');
		});
	});

	describe('DateFormatPreviewGenerator', () => {
		const testDate = new Date('2024-01-15T10:30:45');

		it('should format year patterns correctly', () => {
			expect(DateFormatPreviewGenerator.generate('YYYY', testDate)).toBe('2024');
			expect(DateFormatPreviewGenerator.generate('YY', testDate)).toBe('24');
		});

		it('should format month patterns correctly', () => {
			expect(DateFormatPreviewGenerator.generate('MM', testDate)).toBe('01');
			expect(DateFormatPreviewGenerator.generate('M', testDate)).toBe('1');
			expect(DateFormatPreviewGenerator.generate('MMM', testDate)).toBe('Jan');
			expect(DateFormatPreviewGenerator.generate('MMMM', testDate)).toBe('January');
		});

		it('should format day patterns correctly', () => {
			expect(DateFormatPreviewGenerator.generate('DD', testDate)).toBe('15');
			expect(DateFormatPreviewGenerator.generate('D', testDate)).toBe('15');
		});

		it('should format time patterns correctly', () => {
			expect(DateFormatPreviewGenerator.generate('HH', testDate)).toBe('10');
			expect(DateFormatPreviewGenerator.generate('H', testDate)).toBe('10');
			expect(DateFormatPreviewGenerator.generate('mm', testDate)).toBe('30');
			expect(DateFormatPreviewGenerator.generate('m', testDate)).toBe('30');
			expect(DateFormatPreviewGenerator.generate('ss', testDate)).toBe('45');
			expect(DateFormatPreviewGenerator.generate('s', testDate)).toBe('45');
		});

		it('should format complex patterns correctly', () => {
			const result = DateFormatPreviewGenerator.generate('YYYY-MM-DD HH:mm', testDate);
			expect(result).toBe('2024-01-15 10:30');
		});

		it('should handle mixed patterns', () => {
			const result = DateFormatPreviewGenerator.generate('MMM D, YYYY', testDate);
			expect(result).toBe('Jan 15, 2024');
		});
	});
});
