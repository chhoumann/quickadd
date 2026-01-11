import type { FileViewMode2, OpenLocation } from "../types/fileOpening";

export type FileOpeningSettings = {
	location: OpenLocation;
	direction: "vertical" | "horizontal";
	mode: FileViewMode2;
	focus: boolean;
};

export const DEFAULT_FILE_OPENING: FileOpeningSettings = {
	location: "tab",
	direction: "vertical",
	mode: "default",
	focus: true,
};

export function normalizeFileOpening<
	TExtras extends Record<string, unknown> = Record<string, unknown>,
>(
	fileOpening?: (Partial<FileOpeningSettings> & TExtras) | null,
	options?: { fillMissingOnly?: boolean },
): FileOpeningSettings & TExtras {
	const fillMissingOnly = options?.fillMissingOnly ?? true;

	if (!fillMissingOnly) {
		return {
			...DEFAULT_FILE_OPENING,
			...(fileOpening ?? {}),
		} as FileOpeningSettings & TExtras;
	}

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
