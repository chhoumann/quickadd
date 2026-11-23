import type { FileOpeningSettings } from "../types/fileOpening";

/** How a file opens when nothing says otherwise. */
export const DEFAULT_FILE_OPENING: Readonly<FileOpeningSettings> = {
	location: "tab",
	direction: "vertical",
	mode: "default",
	focus: true,
};

export function normalizeFileOpening(
	fileOpening?: Partial<FileOpeningSettings> | null,
): FileOpeningSettings;
export function normalizeFileOpening<TExtras extends object>(
	fileOpening?: (Partial<FileOpeningSettings> & TExtras) | null,
): FileOpeningSettings & TExtras;
export function normalizeFileOpening<TExtras extends object = Record<string, never>>(
	fileOpening?: (Partial<FileOpeningSettings> & TExtras) | null,
): FileOpeningSettings & TExtras {
	const normalized = { ...(fileOpening ?? {}) } as FileOpeningSettings & TExtras;

	if (normalized.location == null) {
		normalized.location = DEFAULT_FILE_OPENING.location;
	}
	if (normalized.direction == null) {
		normalized.direction = DEFAULT_FILE_OPENING.direction;
	}
	if (normalized.mode == null) {
		normalized.mode = DEFAULT_FILE_OPENING.mode;
	}
	if (normalized.focus == null) {
		normalized.focus = DEFAULT_FILE_OPENING.focus;
	}

	return normalized;
}
