import { TFile, type App } from "obsidian";
import { buildFileDisplayInfos } from "src/utils/fileSyntax";
import { stripMdExtensionForDisplay } from "../suggesters/utils";

/**
 * Renders a vault file path as a Quick-Switcher-style row: the note name on the
 * title line, the parent folder as a muted note line beneath it. Runtime/DOM-only
 * (never invoked in unit tests). Used by the tag-scoped capture picker so it shows
 * note names instead of raw `Some/Deep/Folder/Note.md` paths (issue #745).
 */
export function renderNotePathSuggestion(
	el: HTMLElement,
	path: string,
	app?: App,
): void {
	const lastSlash = path.lastIndexOf("/");
	const parent = lastSlash >= 0 ? path.slice(0, lastSlash) : "";
	const basename = stripMdExtensionForDisplay(
		lastSlash >= 0 ? path.slice(lastSlash + 1) : path,
	);
	const file = app?.vault.getAbstractFileByPath(path);
	const info = app && file instanceof TFile
		? buildFileDisplayInfos(
				[file],
				(candidate) => app.metadataCache.getFileCache(candidate),
			)[0]
		: null;
	const title = info?.primary ?? basename;
	const note = info?.secondary ?? parent;

	el.addClass("mod-complex");
	const content = el.createDiv({ cls: "suggestion-content" });
	content.createDiv({ cls: "suggestion-title", text: title });
	if (note) {
		content.createDiv({ cls: "suggestion-note", text: note });
	}
}
