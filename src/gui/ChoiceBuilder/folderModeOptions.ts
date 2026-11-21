import type { FolderMode } from "../../utils/folderMode";

export const folderModeOptions: { value: FolderMode; label: string }[] = [
	{ value: "obsidian-default", label: "Obsidian default" },
	{ value: "specified", label: "In a specific folder" },
	{ value: "active-file", label: "Same folder as current file" },
	{ value: "prompt", label: "Ask for folder each time" },
];

export const folderModeDescriptions: Record<FolderMode, string> = {
	"obsidian-default":
		"Use Obsidian's “Default location for new notes” setting.",
	specified:
		"Create the note in the folder(s) below. With multiple folders, you'll be asked which one when the note is created.",
	"active-file":
		"Create the note next to the currently active file (falls back to the vault root if no file is open).",
	prompt: "Choose any folder in the vault when the note is created.",
};
