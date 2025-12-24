export const INVALID_FOLDER_CONTROL_CHARS_REGEX = /[\u0000-\u001F]/u;
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
