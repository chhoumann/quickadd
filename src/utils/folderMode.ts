import type { TemplateFolderConfig } from "../types/choices/ITemplateChoice";

export type FolderMode =
	| "obsidian-default"
	| "specified"
	| "active-file"
	| "prompt";

/** Canonical folder-mode precedence shared by the template engines and UI. */
export function deriveFolderMode(folder: TemplateFolderConfig): FolderMode {
	if (!folder.enabled) return "obsidian-default";
	if (folder.chooseWhenCreatingNote) return "prompt";
	if (folder.createInSameFolderAsActiveFile) return "active-file";
	return "specified";
}

/**
 * Return a new folder config with the canonical flags for `mode`, preserving
 * `folders` and `chooseFromSubfolders` so switching modes does not lose them.
 */
export function applyFolderMode(
	folder: TemplateFolderConfig,
	mode: FolderMode,
): TemplateFolderConfig {
	switch (mode) {
		case "obsidian-default":
			return {
				...folder,
				enabled: false,
				chooseWhenCreatingNote: false,
				createInSameFolderAsActiveFile: false,
			};
		case "specified":
			return {
				...folder,
				enabled: true,
				chooseWhenCreatingNote: false,
				createInSameFolderAsActiveFile: false,
			};
		case "active-file":
			return {
				...folder,
				enabled: true,
				createInSameFolderAsActiveFile: true,
				chooseWhenCreatingNote: false,
			};
		case "prompt":
			return {
				...folder,
				enabled: true,
				chooseWhenCreatingNote: true,
				createInSameFolderAsActiveFile: false,
			};
	}
}
