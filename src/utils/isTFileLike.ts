import { TFile } from "obsidian";

export function isTFileLike(file: unknown): file is TFile {
	if (file instanceof TFile) return true;
	// Duck-type cross-realm TFile instances (where `instanceof` fails across JS
	// realms) by their shape, but REQUIRE a string `extension`. A TFolder also
	// carries a string `path`, so a `path`-only check accepts folders and lets
	// `getAbstractFileByPath("some/folder")` reach `leaf.openFile(folder)` instead
	// of the intended "File not found". A TFolder has no `extension`, so this
	// rejects it while still tolerating genuine cross-realm files.
	return (
		typeof file === "object" &&
		file !== null &&
		"path" in file &&
		typeof file.path === "string" &&
		"extension" in file &&
		typeof file.extension === "string"
	);
}
