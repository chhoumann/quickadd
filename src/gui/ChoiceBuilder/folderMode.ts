import type { TemplateFolderConfig } from "../../types/choices/ITemplateChoice";

/**
 * The mutually-exclusive destination modes a Template choice can use, surfaced as
 * a single dropdown in the choice builder (#1131). Each mode maps to a canonical
 * combination of the four persisted `folder` booleans; nothing about the stored
 * shape changes, so this is purely a GUI consolidation.
 */
export type FolderMode =
	| "obsidian-default"
	| "specified"
	| "active-file"
	| "prompt";

/**
 * Derive the mode a stored `folder` config resolves to.
 *
 * This MUST mirror `TemplateChoiceEngine.getFolderPath()`'s branch precedence
 * exactly, so the dropdown always shows the mode that will actually run:
 *   - !enabled                          -> Obsidian "Default location for new notes"
 *   - chooseWhenCreatingNote            -> engine branch 2 (prompt across all folders)
 *   - createInSameFolderAsActiveFile    -> engine branch 3 (active file's folder)
 *   - else                              -> engine branches 1 & 4 (folders list, optionally + subfolders)
 *
 * The order below matches the engine: branch 1 (subfolders) is gated by
 * `!(chooseWhenCreatingNote || createInSameFolderAsActiveFile)`, so a legacy
 * choice with several flags set folds to the same mode the engine would run.
 */
export function deriveFolderMode(folder: TemplateFolderConfig): FolderMode {
	if (!folder.enabled) return "obsidian-default";
	if (folder.chooseWhenCreatingNote) return "prompt";
	if (folder.createInSameFolderAsActiveFile) return "active-file";
	return "specified";
}

/**
 * Return a NEW folder config with the canonical flags for `mode`.
 *
 * - `folders[]` (the expensive, user-entered list) is preserved across every
 *   switch, so hiding a mode never deletes the configured folders (#1131: the
 *   reporter's "my config disappeared" anxiety).
 * - `chooseFromSubfolders` is owned by "specified" mode and reset to `false`
 *   everywhere else. It is NOT fully inert outside "specified":
 *   `TemplateInsertEngine.computeChoiceTargetPath` reads it UNGATED, so a leftover
 *   `true` would make the apply-to-note move-offer silently unavailable for an
 *   otherwise-resolvable active-file choice. Resetting keeps every mode canonical.
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
				chooseFromSubfolders: false,
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
				chooseFromSubfolders: false,
			};
		case "prompt":
			return {
				...folder,
				enabled: true,
				chooseWhenCreatingNote: true,
				createInSameFolderAsActiveFile: false,
				chooseFromSubfolders: false,
			};
	}
}

export const FOLDER_MODE_OPTIONS: { value: FolderMode; label: string }[] = [
	{ value: "obsidian-default", label: "Obsidian default" },
	{ value: "specified", label: "In a specific folder" },
	{ value: "active-file", label: "Same folder as current file" },
	{ value: "prompt", label: "Ask for folder each time" },
];

export const FOLDER_MODE_DESCRIPTIONS: Record<FolderMode, string> = {
	"obsidian-default":
		"Use Obsidian's “Default location for new notes” setting.",
	specified:
		"Create the note in the folder(s) below. With multiple folders, you'll be asked which one when the note is created.",
	"active-file":
		"Create the note next to the currently active file (falls back to the vault root if no file is open).",
	prompt: "Choose any folder in the vault when the note is created.",
};
