/**
 * Characters that are forbidden in filenames across different operating systems
 * Windows: < > : " | ? * \ /
 * macOS/Linux: / (and null character)
 * We'll be conservative and forbid all of them for cross-platform compatibility
 */
const FORBIDDEN_CHARS = ['<', '>', ':', '"', '|', '?', '*', '\\', '/'] as const;

function escapeForRegexCharClass(char: string): string {
    // Escape backslash and other regex-class special chars if present
    return char.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&');
}

const FORBIDDEN_CHAR_CLASS = `[${FORBIDDEN_CHARS.map(escapeForRegexCharClass).join('')}]`;

/**
 * Regex to find all forbidden characters
 */
const FORBIDDEN_FILENAME_CHARS = new RegExp(FORBIDDEN_CHAR_CLASS, 'g');

/**
 * Regex to test if any forbidden character exists
 */
const FORBIDDEN_FILENAME_PATTERN = new RegExp(FORBIDDEN_CHAR_CLASS);

/**
 * Get a user-friendly list of forbidden characters
 */
export function getForbiddenCharsList(): string {
	// Keep this formatting stable for tests and user messaging
	return '< > : " | ? * \\ /';
}

/**
 * Check if a filename contains forbidden characters
 * @param filename The filename to validate (without path)
 * @returns true if the filename is valid, false otherwise
 */
const WINDOWS_RESERVED = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
]);

export function isValidFilename(filename: string): boolean {
	if (!filename || filename.trim() === '') {
		return false;
	}
	
	// Check for forbidden characters
	if (FORBIDDEN_FILENAME_PATTERN.test(filename)) {
		return false;
	}
	
	const nameWithoutExt = filename.replace(/\.(md|canvas)$/i, '');
	if (WINDOWS_RESERVED.has(nameWithoutExt.toUpperCase())) {
		return false;
	}
	
	// Check if filename ends with dot or space (invalid on Windows)
	if (/[. ]$/.test(nameWithoutExt)) {
		return false;
	}
	
	return true;
}

/**
 * Get the invalid characters found in a filename
 * @param filename The filename to check
 * @returns Array of invalid characters found, or empty array if none
 */
export function getInvalidChars(filename: string): string[] {
	const matches = filename.match(FORBIDDEN_FILENAME_CHARS);
	return matches ? [...new Set(matches)] : [];
}

/**
 * Sanitize a filename by removing forbidden characters
 * @param filename The filename to sanitize
 * @param replacement The character to replace forbidden characters with (default: '_')
 * @returns Sanitized filename
 */
export function sanitizeFilename(filename: string, replacement: string = '_'): string {
	// Replace forbidden characters
	let sanitized = filename.replace(FORBIDDEN_FILENAME_CHARS, replacement);
	
	const nameWithoutExt = sanitized.replace(/\.(md|canvas)$/i, '');
	const ext = sanitized.match(/\.(md|canvas)$/i)?.[0] || '';
	
	if (WINDOWS_RESERVED.has(nameWithoutExt.toUpperCase())) {
		sanitized = `${nameWithoutExt}_reserved${ext}`;
	}
	
	// Remove trailing dots and spaces
	sanitized = sanitized.replace(/([. ]+)(\.(md|canvas))?$/i, '$2');
	
	return sanitized;
}

/**
 * Create a detailed error message for invalid filename
 * @param filename The invalid filename
 * @returns Detailed error message
 */
export function getInvalidFilenameError(filename: string): string {
	const invalidChars = getInvalidChars(filename);
	
	if (invalidChars.length > 0) {
		return `Filename contains forbidden characters: ${invalidChars.join(', ')}. Please remove these characters: ${getForbiddenCharsList()}`;
	}
	
	if (!filename || filename.trim() === '') {
		return 'Filename cannot be empty';
	}
	
	const nameWithoutExt = filename.replace(/\.(md|canvas)$/i, '');
	
	if (WINDOWS_RESERVED.has(nameWithoutExt.toUpperCase())) {
		return `"${nameWithoutExt}" is a reserved system name and cannot be used as a filename`;
	}
	
	if (/[. ]$/.test(nameWithoutExt)) {
		return 'Filename cannot end with a dot or space';
	}
	
	return 'Invalid filename';
}

/**
 * Validate a filename and throw with a detailed message if invalid.
 * @param filename The filename to validate (without path)
 * @param messagePrefix Optional message prefix for the thrown Error
 */
export function validateFilenameOrThrow(filename: string, messagePrefix?: string): void {
    if (!isValidFilename(filename)) {
        const msg = getInvalidFilenameError(filename);
        throw new Error(messagePrefix ? `${messagePrefix}${msg}` : msg);
    }
}
