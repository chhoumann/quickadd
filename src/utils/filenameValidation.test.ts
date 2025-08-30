import { describe, expect, it } from 'vitest';
import {
	isValidFilename,
	getInvalidChars,
	sanitizeFilename,
	getInvalidFilenameError,
	getForbiddenCharsList
} from './filenameValidation';

describe('filenameValidation', () => {
	describe('isValidFilename', () => {
		it('should reject filenames with colons', () => {
			expect(isValidFilename('test:file.md')).toBe(false);
			expect(isValidFilename('12:30.md')).toBe(false);
			expect(isValidFilename('Meeting: Important.md')).toBe(false);
		});

		it('should reject filenames with other forbidden characters', () => {
			expect(isValidFilename('test<file.md')).toBe(false);
			expect(isValidFilename('test>file.md')).toBe(false);
			expect(isValidFilename('test"file.md')).toBe(false);
			expect(isValidFilename('test|file.md')).toBe(false);
			expect(isValidFilename('test?file.md')).toBe(false);
			expect(isValidFilename('test*file.md')).toBe(false);
			expect(isValidFilename('test\\file.md')).toBe(false);
			expect(isValidFilename('test/file.md')).toBe(false);
		});

		it('should accept valid filenames', () => {
			expect(isValidFilename('test-file.md')).toBe(true);
			expect(isValidFilename('test_file.md')).toBe(true);
			expect(isValidFilename('test.file.md')).toBe(true);
			expect(isValidFilename('test file.md')).toBe(true);
			expect(isValidFilename('12-30.md')).toBe(true);
			expect(isValidFilename('Meeting - Important.md')).toBe(true);
		});

		it('should reject empty filenames', () => {
			expect(isValidFilename('')).toBe(false);
			expect(isValidFilename('   ')).toBe(false);
		});

		it('should reject Windows reserved names', () => {
			expect(isValidFilename('CON.md')).toBe(false);
			expect(isValidFilename('PRN.md')).toBe(false);
			expect(isValidFilename('AUX.md')).toBe(false);
			expect(isValidFilename('NUL.md')).toBe(false);
			expect(isValidFilename('COM1.md')).toBe(false);
			expect(isValidFilename('LPT1.md')).toBe(false);
		});

		it('should reject filenames ending with dots or spaces', () => {
			expect(isValidFilename('test..md')).toBe(false);
			expect(isValidFilename('test .md')).toBe(false);
		});

		it('should work with canvas files', () => {
			expect(isValidFilename('test:file.canvas')).toBe(false);
			expect(isValidFilename('test-file.canvas')).toBe(true);
		});
	});

	describe('getInvalidChars', () => {
		it('should return invalid characters in filename', () => {
			expect(getInvalidChars('test:file.md')).toEqual([':']);
			expect(getInvalidChars('test:file|name?.md')).toEqual([':', '|', '?']);
			expect(getInvalidChars('valid-file.md')).toEqual([]);
		});

		it('should return unique characters only', () => {
			expect(getInvalidChars('test:file:name.md')).toEqual([':']);
		});
	});

	describe('sanitizeFilename', () => {
		it('should replace forbidden characters with underscore by default', () => {
			expect(sanitizeFilename('test:file.md')).toBe('test_file.md');
			expect(sanitizeFilename('test<>file.md')).toBe('test__file.md');
			expect(sanitizeFilename('test|file?.md')).toBe('test_file_.md');
		});

		it('should use custom replacement character', () => {
			expect(sanitizeFilename('test:file.md', '-')).toBe('test-file.md');
			expect(sanitizeFilename('test<>file.md', '')).toBe('testfile.md');
		});

		it('should handle Windows reserved names', () => {
			expect(sanitizeFilename('CON.md')).toBe('CON_reserved.md');
			expect(sanitizeFilename('PRN.md')).toBe('PRN_reserved.md');
		});

		it('should remove trailing dots and spaces', () => {
			expect(sanitizeFilename('test..md')).toBe('test.md');
			expect(sanitizeFilename('test .md')).toBe('test.md');
			expect(sanitizeFilename('test... .md')).toBe('test.md');
		});
	});

	describe('getInvalidFilenameError', () => {
		it('should provide specific error for invalid characters', () => {
			const error = getInvalidFilenameError('test:file.md');
			expect(error).toContain('Filename contains forbidden characters: :');
			expect(error).toContain(getForbiddenCharsList());
		});

		it('should provide error for multiple invalid characters', () => {
			const error = getInvalidFilenameError('test:file|name?.md');
			expect(error).toContain('Filename contains forbidden characters: :, |, ?');
		});

		it('should provide error for empty filename', () => {
			const error = getInvalidFilenameError('');
			expect(error).toBe('Filename cannot be empty');
		});

		it('should provide error for reserved names', () => {
			const error = getInvalidFilenameError('CON.md');
			expect(error).toContain('"CON" is a reserved system name');
		});

		it('should provide error for trailing dots/spaces', () => {
			const error = getInvalidFilenameError('test..md');
			expect(error).toBe('Filename cannot end with a dot or space');
		});
	});

	describe('getForbiddenCharsList', () => {
		it('should return the list of forbidden characters', () => {
			const list = getForbiddenCharsList();
			expect(list).toBe('< > : " | ? * \\ /');
		});
	});
});