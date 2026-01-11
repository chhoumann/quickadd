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

export function normalizeFileOpening(
	fileOpening?: Partial<FileOpeningSettings> | null,
): FileOpeningSettings {
	return {
		...DEFAULT_FILE_OPENING,
		...(fileOpening ?? {}),
	};
}
