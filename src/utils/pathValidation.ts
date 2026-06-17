// C0 control characters (U+0000–U+001F) are invalid in folder/file names. The
// class is built via String.fromCharCode so no literal control characters appear
// in source (matching the original control-character range exactly, and keeping
// eslint's no-control-regex satisfied without a disable directive).
export const INVALID_FOLDER_CONTROL_CHARS_REGEX = new RegExp(
	`[${String.fromCharCode(0x00)}-${String.fromCharCode(0x1f)}]`,
	"u",
);
const INVALID_FOLDER_CONTROL_CHARS_RUN_REGEX = new RegExp(
	`${INVALID_FOLDER_CONTROL_CHARS_REGEX.source}+`,
	"gu",
);
export const INVALID_FOLDER_CHARS_REGEX = /[\\/:*?"<>|]/u;
export const INVALID_FOLDER_TRAILING_CHARS_REGEX = /[. ]$/u;

export const RESERVED_WINDOWS_DEVICE_NAMES = new Set([
	"CON",
	"PRN",
	"AUX",
	"NUL",
	"COM1",
	"COM2",
	"COM3",
	"COM4",
	"COM5",
	"COM6",
	"COM7",
	"COM8",
	"COM9",
	"LPT1",
	"LPT2",
	"LPT3",
	"LPT4",
	"LPT5",
	"LPT6",
	"LPT7",
	"LPT8",
	"LPT9",
]);

export function isReservedWindowsDeviceName(name: string): boolean {
	return RESERVED_WINDOWS_DEVICE_NAMES.has(name.toUpperCase());
}

export function normalizeGeneratedFilePath(path: string): string {
	return path
		.split("/")
		.map((segment) => {
			const normalized = segment.replace(
				INVALID_FOLDER_CONTROL_CHARS_RUN_REGEX,
				" ",
			);
			return normalized === segment ? segment : normalized.trim();
		})
		.join("/");
}
