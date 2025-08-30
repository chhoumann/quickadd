/**
 * Characters that are forbidden in filenames across different operating systems
 * Windows: < > : " | ? * \ /
 * macOS/Linux: / (and null character)
 * We'll be conservative and forbid all of them for cross-platform compatibility
 */
const FORBIDDEN_FILENAME_CHARS = /[<>:"|?*\\/]/g;

/**
 * Regex pattern to match forbidden characters (for validation)
 */
const FORBIDDEN_FILENAME_PATTERN = /[<>:"|?*\\/]/;

/**
 * Get a user-friendly list of forbidden characters
 */
export function getForbiddenCharsList(): string {
	return '< > : " | ? * \\ /';
}

/**
 * Check if a filename contains forbidden characters
 * @param filename The filename to validate (without path)
 * @returns true if the filename is valid, false otherwise
 */
export function isValidFilename(filename: string): boolean {
	if (!filename || filename.trim() === '') {
		return false;
	}
	
	// Check for forbidden characters
	if (FORBIDDEN_FILENAME_PATTERN.test(filename)) {
		return false;
	}
	
	// Check for reserved names on Windows
	const reserved = [
		'CON', 'PRN', 'AUX', 'NUL',
		'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
		'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
	];
	
	const nameWithoutExt = filename.replace(/\.(md|canvas)$/i, '');
	if (reserved.includes(nameWithoutExt.toUpperCase())) {
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
	
	// Handle reserved names on Windows
	const reserved = [
		'CON', 'PRN', 'AUX', 'NUL',
		'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
		'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
	];
	
	const nameWithoutExt = sanitized.replace(/\.(md|canvas)$/i, '');
	const ext = sanitized.match(/\.(md|canvas)$/i)?.[0] || '';
	
	if (reserved.includes(nameWithoutExt.toUpperCase())) {
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
	
	// Check for reserved names
	const reserved = [
		'CON', 'PRN', 'AUX', 'NUL',
		'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
		'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
	];
	
	if (reserved.includes(nameWithoutExt.toUpperCase())) {
		return `"${nameWithoutExt}" is a reserved system name and cannot be used as a filename`;
	}
	
	if (/[. ]$/.test(nameWithoutExt)) {
		return 'Filename cannot end with a dot or space';
	}
	
	return 'Invalid filename';
}